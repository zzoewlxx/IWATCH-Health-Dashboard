"""Your own comparisons: nights with something against nights without it.

Each comparison splits nights into two groups, say nights after an evening workout and
nights after a day without training, and compares that night's sleep: when it started,
how long it lasted, sleeping heart rate and sleeping HRV. The answer is a difference with
a 95% interval. An interval that crosses zero means "no difference you can see yet",
which with a few dozen nights is the most common and the most honest answer.

Weekend and weekday nights are compared separately and then combined, so that a group
that happens to hold more Saturdays does not look different for that reason alone. The
interval comes from resampling the nights (a bootstrap). Because many differences are
looked at together, a Benjamini-Hochberg correction decides which of them to call clear.
These are the wearer's own observations, not an experiment: a clear difference still
does not say what caused it. Settings are in reference.json (own_comparisons).
"""
from __future__ import annotations

import math
import random
import zlib
from bisect import bisect_left
from datetime import date

# (daily key, name, unit, factor from the stored unit to the shown one)
OUTCOMES = [
    ("bedtime", "入睡时间", "分钟", 1),
    ("sleepTotal", "睡眠时长", "分钟", 60),
    ("sleepHr", "睡眠心率", "次/分", 1),
    ("sleepHrv", "睡眠 HRV", "ms", 1),
]


def bh_adjust(pvalues: list[float]) -> list[float]:
    """Benjamini-Hochberg adjusted p-values (q-values), in the order given."""
    m = len(pvalues)
    order = sorted(range(m), key=lambda k: pvalues[k])
    q = [1.0] * m
    running = 1.0
    for rank in range(m, 0, -1):
        k = order[rank - 1]
        running = min(running, pvalues[k] * m / rank)
        q[k] = running
    return q


def compare(a: list[tuple[float, int]], b: list[tuple[float, int]], *, min_nights: int, min_per_stratum: int,
            resamples: int, level: float, seed: int) -> dict:
    """Difference of means, group a minus group b, stratum by stratum.

    ``a`` and ``b`` hold (value, stratum). Strata with fewer than ``min_per_stratum`` nights
    on either side are left out; the stratum differences are averaged with weights
    na * nb / (na + nb). Returns {nA, nB, meanA, meanB, diff, lo, hi, p}; with fewer than
    ``min_nights`` nights left on either side, diff and what follows are None.
    """
    groups: dict[int, tuple[list[float], list[float]]] = {}
    for v, s in a:
        groups.setdefault(s, ([], []))[0].append(v)
    for v, s in b:
        groups.setdefault(s, ([], []))[1].append(v)
    kept = {s: g for s, g in sorted(groups.items())
            if len(g[0]) >= min_per_stratum and len(g[1]) >= min_per_stratum}
    na = sum(len(g[0]) for g in kept.values())
    nb = sum(len(g[1]) for g in kept.values())
    out = {"nA": len(a), "nB": len(b), "meanA": None, "meanB": None, "diff": None, "lo": None, "hi": None, "p": None}
    if na < min_nights or nb < min_nights:
        return out
    weight = {s: len(x) * len(y) / (len(x) + len(y)) for s, (x, y) in kept.items()}
    total = sum(weight.values())
    diff = sum(weight[s] * (sum(x) / len(x) - sum(y) / len(y)) for s, (x, y) in kept.items()) / total
    rng = random.Random(seed)
    boots = []
    for _ in range(resamples):
        acc = 0.0
        for s, (x, y) in kept.items():
            acc += weight[s] * (sum(rng.choices(x, k=len(x))) / len(x) - sum(rng.choices(y, k=len(y))) / len(y))
        boots.append(acc / total)
    boots.sort()
    tail = (1 - level) / 2
    lo = boots[int(math.floor(tail * resamples))]
    hi = boots[int(math.ceil((1 - tail) * resamples)) - 1]
    below = sum(1 for v in boots if v <= 0)
    above = sum(1 for v in boots if v >= 0)
    p = max(1 / resamples, min(1.0, 2 * min(below, above) / resamples))
    xs = [v for x, _y in kept.values() for v in x]
    ys = [v for _x, y in kept.values() for v in y]
    out.update(nA=na, nB=nb, meanA=sum(xs) / len(xs), meanB=sum(ys) / len(ys), diff=diff, lo=lo, hi=hi, p=p)
    return out


def _minute(hhmm: str) -> int:
    return int(hhmm[:2]) * 60 + int(hhmm[3:5])


def build_contrasts(*, days: list[str], daily: dict[str, list], workouts: list[dict], sessions: list,
                    annotations: list[dict], params: dict[str, dict]) -> dict:
    """Every comparison with enough nights, ready for the insights page.

    ``sessions`` are headphone listening sessions as built by audio.py
    ([day, start minute, span minutes, ...]); ``annotations`` come from annotations.py.
    """
    p = params["own_comparisons"]
    n = len(days)
    bed = daily.get("bedtime") or [None] * n
    total = daily.get("sleepTotal") or [None] * n
    cut = daily.get("sleepCut") or [None] * n
    weekend = [date.fromisoformat(d).weekday() >= 5 for d in days]

    def onset(d: int) -> int | None:
        """Sleep onset of the night that ends on day d, in minutes since day 0's midnight."""
        if total[d] is None or bed[d] is None or bed[d] > p["max_bedtime_min"]:
            return None                               # no measured sleep, or a daytime main sleep
        return d * 1440 + bed[d]

    def value(key: str, d: int) -> float | None:
        if onset(d) is None:
            return None
        if key == "sleepTotal" and cut[d]:
            return None                               # the record was probably cut short
        series = daily.get(key)
        return None if series is None or series[d] is None else series[d]

    items: list[dict] = []

    def add(cid: str, title: str, label_a: str, label_b: str, nights_a: list[int], nights_b: list[int],
            note: str = "", keys: tuple[str, ...] | None = None, stratum=None) -> None:
        """``keys`` limits the outcomes; ``stratum`` maps a night to its group (default: weekend or not)."""
        group = stratum or (lambda d: int(weekend[d]))
        rows = []
        for key, _name, _unit, factor in OUTCOMES:
            if keys is not None and key not in keys:
                continue
            a = [(value(key, d) * factor, group(d)) for d in nights_a if value(key, d) is not None]
            b = [(value(key, d) * factor, group(d)) for d in nights_b if value(key, d) is not None]
            seed = zlib.crc32(f"{cid}|{key}".encode()) ^ p["seed"]
            r = compare(a, b, min_nights=p["min_nights"], min_per_stratum=p["min_per_stratum"],
                        resamples=p["resamples"], level=p["level"], seed=seed)
            r["key"] = key
            rows.append(r)
        items.append({"id": cid, "title": title, "a": label_a, "b": label_b, "note": note,
                      "nA": len(nights_a), "nB": len(nights_b), "rows": rows})

    # --- evening workouts against days without training ---------------------------------
    # By the clock, not by "hours before sleep": a definition that leans on that night's
    # bedtime would sort late nights out of the workout group and fake an earlier bedtime.
    timed = [w for w in workouts if w.get("time")]
    if timed:
        trained = {w["d"] for w in timed}
        evening_days = {w["d"] for w in timed if _minute(w["time"]) + w["min"] >= p["evening_from_min"]}
        first = min(trained)
        evening = [d for d in range(first + 1, n) if d - 1 in evening_days]
        rest = [d for d in range(first + 1, n) if d - 1 not in trained]
        hour = p["evening_from_min"] // 60
        add("evening_workout", "傍晚训练和睡眠", f"前一天 {hour} 点以后结束了训练", "前一天没有训练记录", evening, rest)

    # --- headphones in the hour before sleep -----------------------------------------------
    if sessions:
        spans = sorted((s[0] * 1440 + s[1], s[0] * 1440 + s[1] + s[2]) for s in sessions)
        starts = [a for a, _b in spans]
        first, last = min(s[0] for s in sessions), max(s[0] for s in sessions)
        window = p["listen_window_min"]
        heard, quiet = [], []
        for d in range(first, min(n, last + 2)):
            o = onset(d)
            if o is None:
                continue
            k = bisect_left(starts, o)
            hit = False
            j = k - 1
            while j >= 0 and starts[j] > o - 1440:
                if spans[j][1] > o - window:
                    hit = True
                    break
                j -= 1
            (heard if hit else quiet).append(d)
        # The groups are formed around each night's bedtime, so bedtime itself is not
        # compared, and early and late nights are compared separately.
        both = sorted(bed[d] for d in heard + quiet)
        if both:
            mid = both[len(both) // 2]
            add("listen_before_sleep", "入睡前听耳机和睡眠", f"入睡前 {window} 分钟内在用耳机", "没有用耳机", heard, quiet,
                note="按入睡前一小时分组，所以不比较入睡时间；入睡早晚和周末分开比较",
                keys=("sleepTotal", "sleepHr", "sleepHrv"), stratum=lambda d: int(weekend[d]) * 2 + int(bed[d] > mid))

    # --- daylight during the day before ------------------------------------------------------
    light = daily.get("daylight") or [None] * n
    pairs = sorted((light[d - 1], d) for d in range(1, n) if light[d - 1] is not None and onset(d) is not None)
    k = int(len(pairs) * p["daylight_share"])
    if k >= 1:
        lo_cut, hi_cut = pairs[k - 1][0], pairs[len(pairs) - k][0]
        if hi_cut > lo_cut:
            bright = [d for v, d in pairs if v >= hi_cut]
            dim = [d for v, d in pairs if v <= lo_cut]
            add("daylight", "白天日照和当晚睡眠", f"日照 {hi_cut:g} 分钟以上的日子", f"日照 {lo_cut:g} 分钟以下的日子",
                bright, dim, note="比较的是白天的日照和当天晚上的睡眠")

    # --- the wearer's own tags: the night of the tagged day -----------------------------------
    by_day = {e["d"]: e for e in annotations}
    pending = []
    if by_day:
        first = min(by_day)
        counts: dict[str, int] = {}
        for e in annotations:
            for tag in e["tags"]:
                counts[tag] = counts.get(tag, 0) + 1
        plain = [d for d in range(first + 1, n) if d - 1 not in by_day]
        for tag, c in sorted(counts.items(), key=lambda kv: -kv[1]):
            if c < p["min_nights"]:
                pending.append({"tag": tag, "days": c})
                continue
            tagged = [d for d in range(first + 1, n) if d - 1 in by_day and tag in by_day[d - 1]["tags"]]
            add("tag:" + tag, f"标注“{tag}”的那天晚上", f"标注了“{tag}”的那天", "前一天没有任何标注", tagged, plain)

    flat = [r for item in items for r in item["rows"] if r["p"] is not None]
    for r, q in zip(flat, bh_adjust([r["p"] for r in flat])):
        r["q"] = q
    for item in items:
        for r in item["rows"]:
            q = r.get("q")
            if r["diff"] is None:
                r["verdict"] = "few"
            elif r["lo"] > 0 or r["hi"] < 0:
                r["verdict"] = "clear" if q is not None and q <= p["fdr"] else "maybe"
            else:
                r["verdict"] = "none"
            for k2 in ("meanA", "meanB", "diff", "lo", "hi"):
                if r[k2] is not None:
                    r[k2] = round(r[k2], 1)
            for k2 in ("p", "q"):
                if r.get(k2) is not None:
                    r[k2] = round(r[k2], 4)
    return {
        "outcomes": [{"key": k, "name": name, "unit": unit} for k, name, unit, _f in OUTCOMES],
        "items": items, "tagsPending": pending, "fdr": p["fdr"], "level": p["level"],
        "resamples": p["resamples"], "minNights": p["min_nights"],
    }
