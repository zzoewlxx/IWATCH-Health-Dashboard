"""Nightly sleep metrics from SleepAnalysis samples.

A "sleep day" runs 18:00 -> 18:00 local time and is named after the date it ends on,
so a night that starts at 23:40 on the 3rd and a nap at 14:00 on the 4th both belong to
the 4th. This is the same convention the Health app uses.
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections import defaultdict
from statistics import median

from .tz import DAY, Timeline

ASLEEP = {"AsleepDeep": "deep", "AsleepCore": "core", "AsleepREM": "rem",
          "AsleepUnspecified": "unspec", "Asleep": "unspec"}
STAGE_CODE = {"deep": 0, "core": 1, "rem": 2, "unspec": 3, "awake": 4, "inbed": 5}
SESSION_GAP = 90 * 60          # a longer break starts a new session (a nap, or a second sleep)
DAY_SHIFT = 6 * 3600           # 18:00 + 6h = midnight: puts a night on its wake-up date


def _trim(segs: list[list]) -> list[list]:
    """Sort and cut overlaps so no second is counted twice within one source."""
    segs.sort(key=lambda s: (s[0], s[1]))
    out: list[list] = []
    cursor = None
    for s, e, k in segs:
        if cursor is not None and s < cursor:
            s = cursor
        if e <= s:
            continue
        out.append([s, e, k])
        cursor = e
    return out


def _sessions(stage: list[list], inbed: list[list]) -> list[dict]:
    allsegs = sorted(stage + inbed, key=lambda s: s[0])
    sessions: list[dict] = []
    cur = None
    for s, e, k in allsegs:
        if cur is None or s - cur["end"] > SESSION_GAP:
            cur = {"start": s, "end": e, "segs": []}
            sessions.append(cur)
        cur["segs"].append((s, e, k))
        if e > cur["end"]:
            cur["end"] = e
    for ses in sessions:
        ses["asleep"] = sum(e - s for s, e, k in ses["segs"] if k not in ("awake", "inbed"))
        ses["inbed"] = sum(e - s for s, e, k in ses["segs"] if k == "inbed")
        ses["staged"] = any(k in ("deep", "core", "rem") for _, _, k in ses["segs"])
    return sessions


class _Series:
    """Sorted point measurements with a fast 'values inside these intervals' lookup."""

    def __init__(self, records: list[tuple], lo: float = float("-inf"), hi: float = float("inf")):
        recs = sorted((r[0], r[2]) for r in records if lo <= r[2] <= hi)
        self.ts = [r[0] for r in recs]
        self.v = [r[1] for r in recs]

    def within(self, spans: list[tuple[int, int]]) -> list[float]:
        out: list[float] = []
        for s, e in spans:
            out.extend(self.v[bisect_left(self.ts, s): bisect_right(self.ts, e)])
        return out

    def within_ts(self, spans: list[tuple[int, int]]) -> list[tuple[int, float]]:
        out = []
        for s, e in spans:
            i, j = bisect_left(self.ts, s), bisect_right(self.ts, e)
            out.extend(zip(self.ts[i:j], self.v[i:j]))
        return out


def _mean(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


def truncated_nights(total: list, gap: list, *, ratio: float = 0.75, history: int = 28,
                     min_history: int = 7, default_hours: float = 7.0) -> list:
    """Which nights were probably cut short: 1 = yes, 0 = no, None = cannot tell.

    Both must hold: heart-rate readings stopped the moment sleep ended (``gap``: the watch
    came off or ran flat), and the night is clearly shorter than usual (under ``ratio`` x
    the median of up to ``history`` earlier nights, or of ``default_hours`` while there are
    fewer than ``min_history`` of them). Taking the watch off to charge right after waking
    leaves the same gap after a normal-length night, and that night still counts.
    """
    out: list = [None] * len(total)
    for d, g in enumerate(gap):
        if g is None or total[d] is None:
            continue
        prior = [total[j] for j in range(max(0, d - history), d) if total[j] is not None and out[j] != 1]
        usual = median(prior) if len(prior) >= min_history else default_hours
        out[d] = 1 if g and total[d] < ratio * usual else 0
    return out


def build_nights(samples: list[tuple], tl: Timeline, rank: dict[int, int], day0: int, ndays: int,
                 hr: list[tuple], hrv: list[tuple], spo2: list[tuple], cut: dict | None = None) -> dict:
    """``cut``: the sleep_duration parameters from reference.json (cut_window_min, cut_short_ratio,
    cut_history_nights, cut_min_history, cut_default_hours); see truncated_nights."""
    cut = cut or {}
    cut_window = int(cut.get("cut_window_min", 60) * 60)
    gap: list[bool | None] = [None] * ndays
    per_src: dict[int, dict[str, list]] = defaultdict(lambda: {"stage": [], "inbed": []})
    for s, e, val, src, _tz in samples:
        if e <= s:
            continue
        if val == "InBed":
            per_src[src]["inbed"].append([s, e, "inbed"])
        elif val == "Awake":
            per_src[src]["stage"].append([s, e, "awake"])
        elif val in ASLEEP:
            per_src[src]["stage"].append([s, e, ASLEEP[val]])

    # night -> source -> sessions
    by_day: dict[int, dict[int, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for src, parts in per_src.items():
        for ses in _sessions(_trim(parts["stage"]), _trim(parts["inbed"])):
            ses["off"] = tl.offset(ses["start"])
            d = (ses["start"] + ses["off"] + DAY_SHIFT) // DAY - day0
            if 0 <= d < ndays:
                by_day[d][src].append(ses)

    hr_s, hrv_s, spo2_s = _Series(hr, 25, 240), _Series(hrv), _Series(spo2)

    keys = ["sleepTotal", "sleepDeep", "sleepCore", "sleepRem", "sleepUnspec", "sleepAwake", "sleepInBed",
            "sleepNap", "bedtime", "waketime", "sleepEff", "wakeCount", "sleepHr", "sleepHrLow",
            "sleepHrv", "sleepSpo2", "deepPct", "remPct", "corePct", "sleepCut"]
    out: dict[str, list] = {k: [None] * ndays for k in keys}
    kind: list[str | None] = [None] * ndays
    src_of: list[int | None] = [None] * ndays
    segs_out: list[list] = []

    for d, cands in by_day.items():
        def quality(src: int) -> tuple:
            ses = cands[src]
            asleep = sum(x["asleep"] for x in ses)
            level = 2 if any(x["staged"] for x in ses) else 1 if asleep > 0 else 0
            return (level, -rank.get(src, 99), asleep)

        src = max(cands, key=quality)
        sessions = cands[src]
        asleep_total = sum(x["asleep"] for x in sessions)
        staged = any(x["staged"] for x in sessions)
        src_of[d] = src
        midnight = (day0 + d) * DAY                           # in local seconds

        stage_sec: dict[str, int] = defaultdict(int)
        for ses in sessions:
            for s, e, k in ses["segs"]:
                stage_sec[k] += e - s

        if asleep_total > 0:
            kind[d] = "stages" if staged else "asleep"
            main = max(sessions, key=lambda x: x["asleep"])
            sleeping = [(s, e) for s, e, k in main["segs"] if k not in ("awake", "inbed")]
            onset, wake = sleeping[0][0], max(e for _, e in sleeping)
            awake_in = [(s, e) for s, e, k in main["segs"] if k == "awake" and s >= onset and e <= wake]
            span = main["end"] - main["start"]
            out["sleepTotal"][d] = asleep_total / 3600
            out["sleepDeep"][d] = stage_sec["deep"] / 3600 if staged else None
            out["sleepCore"][d] = stage_sec["core"] / 3600 if staged else None
            out["sleepRem"][d] = stage_sec["rem"] / 3600 if staged else None
            out["sleepUnspec"][d] = stage_sec["unspec"] / 3600 if stage_sec["unspec"] else (0 if staged else None)
            out["sleepAwake"][d] = sum(e - s for s, e in awake_in) / 60          # minutes
            out["wakeCount"][d] = sum(1 for s, e in awake_in if e - s >= 60)
            out["sleepInBed"][d] = span / 3600
            out["sleepNap"][d] = (asleep_total - main["asleep"]) / 3600
            out["sleepEff"][d] = 100 * main["asleep"] / span if span > 0 else None
            out["bedtime"][d] = (onset + main["off"] - midnight) / 60            # minutes from midnight
            out["waketime"][d] = (wake + main["off"] - midnight) / 60
            if staged and asleep_total > 0:
                out["deepPct"][d] = 100 * stage_sec["deep"] / asleep_total
                out["remPct"][d] = 100 * stage_sec["rem"] / asleep_total
                out["corePct"][d] = 100 * stage_sec["core"] / asleep_total
            all_sleeping = [(s, e) for ses in sessions for s, e, k in ses["segs"] if k not in ("awake", "inbed")]
            beats = hr_s.within_ts(all_sleeping)
            if len(beats) >= 10:
                out["sleepHr"][d] = sum(v for _, v in beats) / len(beats)
                bins: dict[int, list[float]] = defaultdict(list)
                for t, v in beats:
                    bins[t // 300].append(v)
                out["sleepHrLow"][d] = min(sum(v) / len(v) for v in bins.values())
                # Heart rate was being read all night; if the readings stop the moment sleep
                # "ends", the watch came off (or ran flat) and the record may be cut short.
                # Unknown when the export itself ends inside the window.
                if hr_s.ts[-1] >= wake + cut_window:
                    gap[d] = not hr_s.within([(wake + 1, wake + cut_window)])
            out["sleepHrv"][d] = _mean(hrv_s.within([(main["start"], main["end"])]))
            out["sleepSpo2"][d] = _mean(spo2_s.within([(main["start"], main["end"])]))
        else:
            kind[d] = "inbed"                                   # phone/app guess: not measured sleep
            main = max(sessions, key=lambda x: x["inbed"])
            out["sleepInBed"][d] = sum(x["inbed"] for x in sessions) / 3600
            out["bedtime"][d] = (main["start"] + main["off"] - midnight) / 60
            out["waketime"][d] = (main["end"] + main["off"] - midnight) / 60

        row = []
        for ses in sessions:
            for s, e, k in ses["segs"]:
                a = round((s + ses["off"] - midnight) / 60)
                b = round((e + ses["off"] - midnight) / 60)
                if b > a:
                    row.append([a, b, STAGE_CODE[k]])
        if row:
            segs_out.append([d, row])

    out["sleepCut"] = truncated_nights(
        out["sleepTotal"], gap, ratio=cut.get("cut_short_ratio", 0.75), history=cut.get("cut_history_nights", 28),
        min_history=cut.get("cut_min_history", 7), default_hours=cut.get("cut_default_hours", 7.0))
    segs_out.sort(key=lambda r: r[0])
    return {"daily": out, "kind": kind, "src": src_of, "segments": segs_out}
