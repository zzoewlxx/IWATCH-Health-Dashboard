"""Source de-duplication and per-day aggregation."""
from __future__ import annotations

import math
from bisect import bisect_right
from collections import defaultdict

from .tz import DAY, Timeline


def source_rank(sources: list[str], preferred: list[str] | None = None) -> dict[int, int]:
    """Lower rank wins when two sources cover the same moment.

    Default mirrors the Health app: Apple Watch, then iPhone, then everything else in
    order of first appearance. ``preferred`` (from config.json) goes in front.
    """
    preferred = preferred or []

    def key(i: int) -> tuple:
        name = sources[i]
        for p, pat in enumerate(preferred):
            if pat and pat.lower() in name.lower():
                return (0, p, i)
        if "watch" in name.lower():
            return (1, 0, i)
        if "iphone" in name.lower():
            return (2, 0, i)
        return (3, 0, i)

    order = sorted(range(len(sources)), key=key)
    return {src: r for r, src in enumerate(order)}


def overlap_factors(records: list[tuple], rank: dict[int, int]) -> list[float]:
    """For each sample (in the order given): the share of it that still counts once
    time already covered by a higher-priority source has been cut out.

    Works source by source in priority order. A 10-minute phone sample that overlaps
    6 minutes of watch data keeps 0.4; one fully inside watch data keeps 0. Samples
    from the same source are never cut against each other.
    """
    by_src: dict[int, list[int]] = defaultdict(list)
    for i, r in enumerate(records):
        by_src[r[3]].append(i)
    factors = [1.0] * len(records)
    cov_s: list[int] = []
    cov_e: list[int] = []
    for src in sorted(by_src, key=lambda s: rank.get(s, 99)):
        idxs = by_src[src]
        if cov_s:
            n_cov = len(cov_s)
            for i in idxs:
                s, e = records[i][0], records[i][1]
                if e <= s:                                   # instantaneous sample
                    k = bisect_right(cov_s, s) - 1
                    if k >= 0 and cov_e[k] > s:
                        factors[i] = 0.0
                    continue
                k = bisect_right(cov_e, s)                   # first covered span ending after s
                ov = 0
                while k < n_cov and cov_s[k] < e:
                    ov += min(e, cov_e[k]) - max(s, cov_s[k])
                    k += 1
                if ov > 0:
                    factors[i] = max(0.0, 1 - ov / (e - s))
        # fold this source's spans into the covered set
        spans = sorted([(records[i][0], records[i][1]) for i in idxs if records[i][1] > records[i][0]]
                       + list(zip(cov_s, cov_e)))
        cov_s, cov_e = [], []
        for s, e in spans:
            if cov_s and s <= cov_e[-1]:
                if e > cov_e[-1]:
                    cov_e[-1] = e
            else:
                cov_s.append(s)
                cov_e.append(e)
    return factors


def resolve_overlaps(records: list[tuple], rank: dict[int, int]) -> list[tuple]:
    """Remove double counting between sources for a cumulative type (steps, energy...).

    Returns [(start, end, value, src)] sorted by start, with each value scaled by its
    overlap factor and fully covered samples dropped.
    """
    factors = overlap_factors(records, rank)
    out = [(r[0], r[1], r[2] * f, r[3]) for r, f in zip(records, factors) if f > 0]
    out.sort()
    return out


def daily_sum(resolved: list[tuple], tl: Timeline, day0: int, ndays: int,
              by_src: bool = False):
    """Sum per local calendar day; samples that cross midnight are split by duration."""
    total = [0.0] * ndays
    seen = [False] * ndays
    src_tot: list[dict[int, float]] | None = [defaultdict(float) for _ in range(ndays)] if by_src else None

    def add(d: int, v: float, src: int) -> None:
        if 0 <= d < ndays:
            total[d] += v
            seen[d] = True
            if src_tot is not None:
                src_tot[d][src] += v

    for s, e, v, src in resolved:
        off = tl.offset(s)
        ls, le = s + off, e + off
        d = ls // DAY
        if e <= s or (le - 1) // DAY == d:
            add(d - day0, v, src)
            continue
        dur = le - ls
        t = ls
        while t < le:
            nxt = min((t // DAY + 1) * DAY, le)
            add(t // DAY - day0, v * (nxt - t) / dur, src)
            t = nxt
    out = [total[i] if seen[i] else None for i in range(ndays)]
    return (out, src_tot) if by_src else out


def daily_stat(records: list[tuple], tl: Timeline, day0: int, ndays: int, agg: str = "mean",
               shift: int = 0, use_end: bool = False) -> list[float | None]:
    """Per-day statistic of point measurements.

    ``shift`` moves the day boundary (6h puts a whole night on its wake-up date).
    agg: mean | min | max | last | first | dbmean (duration-weighted energy mean of dB).
    """
    groups: dict[int, list] = defaultdict(list)
    for r in sorted(records, key=lambda r: r[1] if use_end else r[0]):
        t = r[1] if use_end else r[0]
        d = (t + tl.offset(t) + shift) // DAY - day0
        if 0 <= d < ndays:
            groups[d].append(r)
    out: list[float | None] = [None] * ndays
    for d, rs in groups.items():
        vals = [r[2] for r in rs]
        if agg == "mean":
            out[d] = sum(vals) / len(vals)
        elif agg == "min":
            out[d] = min(vals)
        elif agg == "max":
            out[d] = max(vals)
        elif agg == "last":
            out[d] = vals[-1]
        elif agg == "first":
            out[d] = vals[0]
        elif agg == "dbmean":
            w = [max(r[1] - r[0], 1) for r in rs]
            out[d] = 10 * math.log10(sum(wi * 10 ** (v / 10) for wi, v in zip(w, vals)) / sum(w))
        else:
            raise ValueError(agg)
    return out


def dominant_source(records: list[tuple], tl: Timeline, day0: int, ndays: int,
                    shift: int = 0) -> list[int | None]:
    """Source that contributed most samples each day (for point measurements)."""
    counts: list[dict[int, int] | None] = [None] * ndays
    for r in records:
        d = (r[0] + tl.offset(r[0]) + shift) // DAY - day0
        if 0 <= d < ndays:
            c = counts[d]
            if c is None:
                c = counts[d] = defaultdict(int)
            c[r[3]] += 1
    return [max(c, key=c.get) if c else None for c in counts]


def source_runs(per_day: list[int | None], sources: list[str], days: list[str],
                min_run: int = 5) -> list[dict]:
    """Compress a per-day source id list into [{from, to, src}] runs, ignoring blips."""
    runs: list[list] = []                                    # [first_idx, last_idx, src, n_days]
    for i, s in enumerate(per_day):
        if s is None:
            continue
        if runs and runs[-1][2] == s:
            runs[-1][1] = i
            runs[-1][3] += 1
        else:
            runs.append([i, i, s, 1])
    kept: list[list] = []
    for r in runs:
        if r[3] < min_run and kept:
            continue                                          # a few stray days: not an era
        if kept and kept[-1][2] == r[2]:
            kept[-1][1] = r[1]
            kept[-1][3] += r[3]
        else:
            kept.append(r)
    return [{"from": days[a], "to": days[b], "src": sources[s], "days": n} for a, b, s, n in kept]


def heart_rate_minutes(records: list[tuple], tl: Timeline, day0: int, ndays: int) -> list[list[int] | None]:
    """Per day, a flat [minute_of_day, bpm, minute_of_day, bpm, ...] of 1-minute means.

    This is the full-resolution curve behind the single-day view.
    """
    acc: list[dict[int, list[float]] | None] = [None] * ndays
    for s, _e, v, _src in records:
        if not 25 <= v <= 240:
            continue
        ls = s + tl.offset(s)
        d = ls // DAY - day0
        if not 0 <= d < ndays:
            continue
        a = acc[d]
        if a is None:
            a = acc[d] = {}
        m = (ls % DAY) // 60
        cell = a.get(m)
        if cell is None:
            a[m] = [v, 1]
        else:
            cell[0] += v
            cell[1] += 1
    out: list[list[int] | None] = [None] * ndays
    for d, a in enumerate(acc):
        if a:
            flat: list[int] = []
            for m in sorted(a):
                flat.append(m)
                flat.append(round(a[m][0] / a[m][1]))
            out[d] = flat
    return out


def hourly_sum(resolved: list[tuple], tl: Timeline, day0: int, ndays: int) -> list[list[int] | None]:
    """Per day, 24 hourly totals of a de-duplicated cumulative type (local time)."""
    out: list[list[float] | None] = [None] * ndays
    for s, _e, v, _src in resolved:
        ls = s + tl.offset(s)
        d = ls // DAY - day0
        if 0 <= d < ndays:
            row = out[d]
            if row is None:
                row = out[d] = [0.0] * 24
            row[(ls % DAY) // 3600] += v
    return [None if r is None else [round(x) for x in r] for r in out]


def heart_rate_daily(records: list[tuple], tl: Timeline, day0: int, ndays: int):
    """Daily min / max / average plus an hour-by-hour profile.

    The watch samples every few seconds during workouts and every few minutes at rest,
    so a plain mean over samples is dominated by exercise. The average here is the mean
    of 5-minute bins instead, which weights the day evenly.
    """
    bins: list[dict[int, list[float]] | None] = [None] * ndays
    lo = [None] * ndays
    hi = [None] * ndays
    for s, _e, v, _src in records:
        if not 25 <= v <= 240:
            continue
        ls = s + tl.offset(s)
        d = ls // DAY - day0
        if not 0 <= d < ndays:
            continue
        b = bins[d]
        if b is None:
            b = bins[d] = defaultdict(list)
        b[(ls % DAY) // 300].append(v)
        if lo[d] is None or v < lo[d]:
            lo[d] = v
        if hi[d] is None or v > hi[d]:
            hi[d] = v
    avg: list[float | None] = [None] * ndays
    coverage: list[float | None] = [None] * ndays            # share of the day with any sample
    hourly: list[list[float | None] | None] = [None] * ndays
    for d, b in enumerate(bins):
        if not b:
            continue
        means = {k: sum(v) / len(v) for k, v in b.items()}
        avg[d] = sum(means.values()) / len(means)
        coverage[d] = len(means) / 288
        hours: list[list[float]] = [[] for _ in range(24)]
        for k, m in means.items():
            hours[k // 12].append(m)
        hourly[d] = [sum(h) / len(h) if h else None for h in hours]
    return lo, hi, avg, coverage, hourly
