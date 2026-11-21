"""Headphones and hearing.

The iPhone or iPad writes a headphone audio level while media plays through headphones
(phone calls are not counted): each sample is a stretch of time with its average level in
dB. From those samples come, per local day:

- listening time, with overlapping samples counted once;
- the average level, as an energy average weighted by time (how sound levels combine:
  an hour at 70 dB and an hour at 60 dB average to 67 dB, not 65);
- the sound dose against the WHO-ITU safe-listening standard (H.870): 100 % is 80 dB for
  40 hours in 7 days, and every 3 dB louder halves the time.

Also built here: listening sessions, the headphones used, hearing tests (audiograms) and
loud-sound notifications. Every parameter comes from reference.json.
"""
from __future__ import annotations

import math
from bisect import bisect_right
from collections import defaultdict
from datetime import datetime, timezone

from .parse import Store
from .tz import DAY, Timeline

# Bluetooth model codes Apple writes into the device field. Only codes checked against a
# source are listed; any other pair is shown under the name it reports.
KNOWN_MODELS = {"0x2014": "AirPods Pro 2", "0x2024": "AirPods Pro 2（USB-C）"}


def device_label(dev: dict) -> str:
    return KNOWN_MODELS.get((dev.get("model") or "").lower()) or dev.get("name") or "未知耳机"


def effective(records: list[tuple]) -> list[tuple]:
    """Samples with overlaps cut away, start-sorted: [(start, end, dB, src, device)].

    Where two samples cover the same moment, only the earlier one counts there, so no
    second of listening (or of sound dose) is counted twice. Zero-length samples carry no
    time and are dropped.
    """
    out = []
    reach = None
    for s, e, v, src, dev in sorted(records):
        if reach is not None and s < reach:
            s = reach
        if e > s:
            out.append((s, e, v, src, dev))
        if reach is None or e > reach:
            reach = e
    return out


def dose_percent(seconds: float, db: float, ref_db: float, ref_hours: float) -> float:
    """Share of the weekly reference exposure (ref_db for ref_hours) used by `seconds` at `db`."""
    return 100.0 * seconds / 3600.0 / ref_hours * 10.0 ** ((db - ref_db) / 10.0)


def weekly_hours(db: float, ref_db: float, ref_hours: float) -> float:
    """Hours a week at `db` that make up exactly the reference exposure."""
    return ref_hours * 10.0 ** ((ref_db - db) / 10.0)


def energy_mean(pairs: list[tuple[float, float]]) -> float | None:
    """Time-weighted energy average of [(seconds, dB)]."""
    total = sum(s for s, _ in pairs)
    if total <= 0:
        return None
    return 10.0 * math.log10(sum(s * 10.0 ** (v / 10.0) for s, v in pairs) / total)


def _r(v: float | None, dec: int):
    if v is None:
        return None
    return int(round(v)) if dec == 0 else round(v, dec)


def _hm(local_ts: int) -> str:
    return datetime.fromtimestamp(local_ts, timezone.utc).strftime("%H:%M")


def _date(local_ts: int) -> str:
    return datetime.fromtimestamp(local_ts, timezone.utc).strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------------------
# headphone audio levels
# ---------------------------------------------------------------------------------------

def build_headphones(store: Store, tl: Timeline, day0: int, ndays: int, p: dict) -> dict:
    """Per-day series, per-hour and per-level listening time, headphones and sessions.

    p: the ``headphone_dose`` parameters (ref_db, ref_hours, window_days, session_gap_min,
    level_bins).
    """
    spans = effective(store.headphones)
    ref_db, ref_h, edges = p["ref_db"], p["ref_hours"], p["level_bins"]
    sec, energy, dose = [0.0] * ndays, [0.0] * ndays, [0.0] * ndays
    hourly: list[list[float] | None] = [None] * ndays
    bins: list[list[float] | None] = [None] * ndays
    samples: list[list[float] | None] = [None] * ndays
    ndev = len(store.audio_devices)
    # the same series for each pair of headphones, so the page can show one pair at a time
    dev_day = [[0.0] * ndays for _ in range(ndev)]
    dev_energy = [[0.0] * ndays for _ in range(ndev)]
    dev_dose = [[0.0] * ndays for _ in range(ndev)]
    dev_hourly: list[list[list[float] | None]] = [[None] * ndays for _ in range(ndev)]
    dev_bins: list[list[list[float] | None]] = [[None] * ndays for _ in range(ndev)]
    dev_tot = [{"sec": 0.0, "energy": 0.0, "days": set(), "first": None, "last": None,
                "src": defaultdict(float)} for _ in range(ndev)]

    for s, e, v, src, dev in spans:
        off = tl.offset(s)
        ls, le = s + off, e + off
        w = 10.0 ** (v / 10.0)
        level_bin = bisect_right(edges, v)
        t = ls
        while t < le:                                 # split at every local hour boundary
            nxt = min((t // 3600 + 1) * 3600, le)
            d = t // DAY - day0
            if 0 <= d < ndays:
                secs = nxt - t
                hour = (t % DAY) // 3600
                piece_dose = dose_percent(secs, v, ref_db, ref_h)
                sec[d] += secs
                energy[d] += secs * w
                dose[d] += piece_dose
                if hourly[d] is None:
                    hourly[d] = [0.0] * 24
                    bins[d] = [0.0] * (len(edges) + 1)
                hourly[d][hour] += secs / 60
                bins[d][level_bin] += secs / 60
                dev_day[dev][d] += secs / 60
                dev_energy[dev][d] += secs * w
                dev_dose[dev][d] += piece_dose
                if dev_hourly[dev][d] is None:
                    dev_hourly[dev][d] = [0.0] * 24
                    dev_bins[dev][d] = [0.0] * (len(edges) + 1)
                dev_hourly[dev][d][hour] += secs / 60
                dev_bins[dev][d][level_bin] += secs / 60
                tot = dev_tot[dev]
                tot["sec"] += secs
                tot["energy"] += secs * w
                tot["days"].add(d)
                tot["first"] = d if tot["first"] is None else min(tot["first"], d)
                tot["last"] = d if tot["last"] is None else max(tot["last"], d)
                tot["src"][src] += secs
            t = nxt
        t = ls
        while t < le:                                 # the same span, cut at midnight, for the day view
            day = t // DAY
            nxt = min((day + 1) * DAY, le)
            d = day - day0
            a, b = round((t - day * DAY) / 60, 1), round((nxt - day * DAY) / 60, 1)
            if 0 <= d < ndays and b > a:                # a few seconds round to nothing: totals keep them
                row = samples[d]
                if row is None:
                    row = samples[d] = []
                row += [a, b, round(v, 1)]
            t = nxt

    # headphones, busiest first: their order is also their colour order on the dashboard
    order = sorted((i for i in range(ndev) if dev_tot[i]["sec"] > 0), key=lambda i: -dev_tot[i]["sec"])
    remap = {old: new for new, old in enumerate(order)}
    devices = []
    for i in order:
        tot, info = dev_tot[i], store.audio_devices[i]
        devices.append({
            "label": device_label(info), "name": info["name"], "model": info["model"],
            "maker": info["manufacturer"],
            "minutes": round(tot["sec"] / 60), "days": len(tot["days"]),
            "first": tot["first"], "last": tot["last"],
            "db": _r(10 * math.log10(tot["energy"] / tot["sec"]), 1),
            "sources": [[store.sources[k], round(v / 60)] for k, v in sorted(tot["src"].items(), key=lambda kv: -kv[1])],
        })

    # sessions: a pause longer than session_gap_min, or a change of headphones, starts a new one
    gap = p["session_gap_min"] * 60
    raw_sessions = []
    cur = None
    for s, e, v, src, dev in spans:
        if cur is not None and s - cur["end"] <= gap and dev == cur["dev"]:
            cur["end"] = max(cur["end"], e)
        else:
            cur = {"start": s, "end": e, "dev": dev, "parts": [], "src": defaultdict(float)}
            raw_sessions.append(cur)
        cur["parts"].append((e - s, v))
        cur["src"][src] += e - s
    session_sources: list[str] = []
    sessions = []
    for x in raw_sessions:
        off = tl.offset(x["start"])
        local = x["start"] + off
        d = local // DAY - day0
        if not 0 <= d < ndays or x["dev"] not in remap:
            continue
        name = store.sources[max(x["src"], key=x["src"].get)]
        if name not in session_sources:
            session_sources.append(name)
        sessions.append([d, round((local % DAY) / 60, 1), round((x["end"] - x["start"]) / 60, 1),
                         round(sum(s for s, _ in x["parts"]) / 60, 1), _r(energy_mean(x["parts"]), 1),
                         remap[x["dev"]], session_sources.index(name)])

    listening = [d for d in range(ndays) if sec[d] > 0]
    first = listening[0] if listening else ndays
    win = p["window_days"]
    daily = {
        "listenMin": [None if d < first else round(sec[d] / 60, 1) for d in range(ndays)],
        "headphone": [_r(10 * math.log10(energy[d] / sec[d]), 1) if sec[d] > 0 else None for d in range(ndays)],
        "hpDose": [None if d < first else round(dose[d], 3) for d in range(ndays)],
        "hpDose7": [None if d < first else round(sum(dose[max(0, d - win + 1): d + 1]), 2) for d in range(ndays)],
    }
    return {
        "daily": daily,
        "samples": samples,
        "hourly": [None if h is None else [round(x, 1) for x in h] for h in hourly],
        "bins": [None if b is None else [round(x, 1) for x in b] for b in bins],
        "binEdges": edges,
        "devices": devices,
        "devDaily": [[round(x, 1) for x in dev_day[i]] for i in order],
        "devDb": [[_r(10 * math.log10(dev_energy[i][d] / (dev_day[i][d] * 60)), 1) if dev_day[i][d] > 0 else None
                   for d in range(ndays)] for i in order],
        "devDose": [[round(x, 3) if x else None for x in dev_dose[i]] for i in order],
        "devHourly": [[None if h is None else [round(x, 1) for x in h] for h in dev_hourly[i]] for i in order],
        "devBins": [[None if b is None else [round(x, 1) for x in b] for b in dev_bins[i]] for i in order],
        "sessions": sessions,
        "sessionSources": session_sources,
    }


# ---------------------------------------------------------------------------------------
# hearing tests and notifications
# ---------------------------------------------------------------------------------------

def pure_tone_average(points: list[dict], ear: str, freqs: list[float]) -> float | None:
    """Mean threshold (dB HL) of one ear over `freqs`; None unless every one was tested."""
    got = {pt["hz"]: pt[ear] for pt in points if pt.get(ear) is not None}
    if not all(f in got for f in freqs):
        return None
    return sum(got[f] for f in freqs) / len(freqs)


def hearing_grade(value: float | None, grades: list[list]) -> str | None:
    """Grade of a pure-tone average. Bounds are inclusive and apply to the value rounded to a
    whole dB, as the Health app shows it."""
    if value is None:
        return None
    v = round(value)
    for upper, label in grades:
        if upper is None or v <= upper:
            return label
    return None


def build_hearing_tests(store: Store, tl: Timeline, day0: int, p: dict) -> list[dict]:
    """p: the ``hearing_test`` parameters (pta_freqs, grades)."""
    out = []
    prev = None
    for t in sorted(store.audiograms, key=lambda a: a["start"]):
        local = t["start"] + tl.offset(t["start"])
        pta = [pure_tone_average(t["points"], ear, p["pta_freqs"]) for ear in ("left", "right")]
        change = None
        if prev is not None:
            change = [None if a is None or b is None else round(a - b, 1) for a, b in zip(pta, prev)]
        out.append({
            "d": local // DAY - day0, "date": _date(local), "time": _hm(local),
            "src": store.sources[t["src"]], "device": t["device"],
            "points": [[pt["hz"], _r(pt["left"], 1), _r(pt["right"], 1)] for pt in t["points"]],
            "masked": any(pt["leftMasked"] or pt["rightMasked"] for pt in t["points"]),
            "pta": [_r(v, 1) for v in pta],
            "grade": [hearing_grade(v, p["grades"]) for v in pta],
            "change": change,
        })
        prev = pta
    return out


def build_audio_events(store: Store, tl: Timeline, day0: int) -> list[dict]:
    out = []
    for e in sorted(store.audio_events, key=lambda e: e["start"]):
        local = e["start"] + tl.offset(e["start"])
        out.append({"d": local // DAY - day0, "date": _date(local), "time": _hm(local), "kind": e["kind"],
                    "level": _r(e["level"], 1)})
    return out


def build_audio(store: Store, tl: Timeline, day0: int, ndays: int, params: dict[str, dict]) -> dict:
    """Everything the headphone page needs. ``daily`` and ``samples`` are taken out by the caller
    (into the daily table and the single-day file)."""
    out = build_headphones(store, tl, day0, ndays, params["headphone_dose"])
    out["tests"] = build_hearing_tests(store, tl, day0, params["hearing_test"])
    out["events"] = build_audio_events(store, tl, day0)
    return out
