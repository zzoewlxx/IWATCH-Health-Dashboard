"""Activity intensity from the watch's PhysicalEffort samples (METs).

While it is worn, Apple Watch writes PhysicalEffort back to back around the clock: each
sample is a stretch of time and the effort over it in METs (sitting still is about 1, a
brisk walk 3 to 4). The WHO guidelines call 3 to under 6 METs moderate and 6 or more
vigorous, and count every minute however short the bout. The thresholds come from
reference.json (activity_minutes, activity_pattern).
"""
from __future__ import annotations

from bisect import bisect_left

from .daily import overlap_factors
from .tz import DAY, Timeline


def _spans_overlap(starts: list[int], spans: list[tuple[int, int]], a: int, b: int) -> bool:
    """Whether [a, b) overlaps any of ``spans`` (sorted by start; ``starts`` are their starts)."""
    k = bisect_left(starts, b)
    while k > 0:
        k -= 1
        s, e = spans[k]
        if e > a:
            return True
        if s < a - DAY:                               # no workout lasts a whole day
            return False
    return False


def intensity_daily(records: list[tuple], tl: Timeline, day0: int, ndays: int, rank: dict[int, int], *,
                    moderate: float, vigorous: float, workouts: list[tuple[int, int]] = (),
                    burst: tuple[float, float] = (1, 3), gap: int = 60, min_cover: float = 0.4) -> dict[str, list]:
    """Per local day: minutes at moderate and at vigorous effort, minutes covered by samples,
    and short vigorous bursts outside recorded workouts.

    ``records`` are (start, end, METs, source) in epoch seconds; where two sources cover the
    same moment the higher-ranked one counts (as for steps). ``workouts`` are (start, end).
    A burst is a stretch of samples at ``vigorous`` or more, broken by no more than ``gap``
    seconds, lasting ``burst[0]`` to ``burst[1]`` minutes and touching no workout; it counts
    on the day it starts. A day whose samples cover less than ``min_cover`` of it was hardly
    worn: its minutes and bursts are unknown (None), not small.
    """
    factors = overlap_factors(records, rank)
    cover = [0.0] * ndays
    mod = [0.0] * ndays
    vig = [0.0] * ndays
    seen = [False] * ndays
    vig_samples: list[tuple[int, int]] = []
    for (s, e, v, _src), f in zip(records, factors):
        if e <= s or f <= 0:
            continue
        if v >= vigorous and f >= 0.5:
            vig_samples.append((s, e))
        off = tl.offset(s)
        t, le = s + off, e + off
        while t < le:                                  # split at local midnight, by duration
            nxt = min((t // DAY + 1) * DAY, le)
            d = int(t // DAY) - day0
            if 0 <= d < ndays:
                minutes = (nxt - t) / 60 * f
                seen[d] = True
                cover[d] += minutes
                if v >= vigorous:
                    vig[d] += minutes
                elif v >= moderate:
                    mod[d] += minutes
            t = nxt

    bursts = [0] * ndays
    spans = sorted(workouts)
    starts = [s for s, _e in spans]
    vig_samples.sort()
    run: list[int] | None = None                       # [start, end] of the current vigorous stretch

    def close(r: list[int]) -> None:
        minutes = (r[1] - r[0]) / 60
        if burst[0] <= minutes <= burst[1] and not _spans_overlap(starts, spans, r[0], r[1]):
            d = int(tl.local_day(r[0])) - day0
            if 0 <= d < ndays:
                bursts[d] += 1

    for s, e in vig_samples:
        if run is not None and s - run[1] <= gap:
            run[1] = max(run[1], e)
        else:
            if run is not None:
                close(run)
            run = [s, e]
    if run is not None:
        close(run)

    need = min_cover * DAY / 60
    out: dict[str, list] = {"modMin": [None] * ndays, "vigMin": [None] * ndays,
                            "effortCover": [None] * ndays, "vigBursts": [None] * ndays}
    for d in range(ndays):
        if not seen[d]:
            continue
        out["effortCover"][d] = int(round(cover[d]))
        if cover[d] >= need:
            out["modMin"][d] = round(mod[d], 1)
            out["vigMin"][d] = round(vig[d], 1)
            out["vigBursts"][d] = bursts[d]
    return out
