"""How big a change has to be before it is more than everyday ups and downs.

Hopkins' typical error: take pairs of readings close together in time; the standard
deviation of their differences, divided by the square root of 2, is how far a single
reading usually strays from the wearer's current level. The dashboard uses it to show a
change that stays inside that spread as "flat" instead of as a rise or a fall.

The window and the pairing rules come from reference.json (noise_band).
"""
from __future__ import annotations

import math
from datetime import date

from .analysis import _mean, _sd

# Daily series that are goals, flags or bookkeeping rather than readings.
SKIP = {"sleepCut", "moveGoal", "exerciseGoal", "standGoal", "wear", "effortCover", "hpDose7", "wakeCount"}


def typical_error(values: list, last: int, *, history_days: int, min_pairs: int,
                  max_gap: int) -> tuple[float | None, int]:
    """(typical error, number of pairs) over the ``history_days`` ending on day ``last``.

    A pair is two successive readings at most ``max_gap`` days apart. None when there are
    fewer than ``min_pairs`` pairs.
    """
    diffs: list[float] = []
    prev: tuple[int, float] | None = None
    for i in range(max(0, last - history_days + 1), last + 1):
        v = values[i]
        if v is None:
            continue
        if prev is not None and i - prev[0] <= max_gap:
            diffs.append(v - prev[1])
        prev = (i, v)
    if len(diffs) < min_pairs:
        return None, len(diffs)
    return _sd(diffs) / math.sqrt(2), len(diffs)


def weekday_rhythm(values: list, days: list[str], last: int, *, history_days: int, half: int = 3,
                   min_others: int = 3) -> list[list]:
    """Per weekday (Monday first): [mean, standard error, count] of how far a reading sits
    from the mean of the readings up to ``half`` days either side of it.

    This takes out slow trends, so what is left is the rhythm of the week (weight tends to
    be higher after the weekend and to drift down through the week). Mean and standard
    error are None for weekdays with fewer than four readings.
    """
    by_day: list[list[float]] = [[] for _ in range(7)]
    for i in range(max(0, last - history_days + 1), last + 1):
        v = values[i]
        if v is None:
            continue
        others = [values[j] for j in range(i - half, i + half + 1)
                  if j != i and 0 <= j < len(values) and values[j] is not None]
        if len(others) < min_others:
            continue
        by_day[date.fromisoformat(days[i]).weekday()].append(v - _mean(others))
    out = []
    for xs in by_day:
        if len(xs) < 4:
            out.append([None, None, len(xs)])
        else:
            out.append([round(_mean(xs), 3), round(_sd(xs) / math.sqrt(len(xs)), 3), len(xs)])
    return out


def noise_table(days: list[str], daily: dict[str, list], params: dict) -> dict:
    """Typical error of every daily reading that has enough pairs, plus the weekly rhythm
    of body weight. ``params`` is the noise_band entry of reference.json."""
    last = len(days) - 1
    gaps = params["max_gap_days"]
    keys: dict[str, list] = {}
    for key, series in daily.items():
        if key in SKIP or not isinstance(series, list) or len(series) != len(days):
            continue
        if not any(isinstance(v, (int, float)) and not isinstance(v, bool) for v in series):
            continue
        te, pairs = typical_error(series, last, history_days=params["history_days"], min_pairs=params["min_pairs"],
                                  max_gap=gaps.get(key, gaps["default"]))
        if te is not None:
            keys[key] = [round(te, 3), pairs]
    for key, te in params.get("fallback_te", {}).items():       # too few pairs of its own: a published figure
        if key not in keys and any(v is not None for v in daily.get(key) or []):
            keys[key] = [te, 0]
    rhythm = {}
    if "weight" in daily:
        rows = weekday_rhythm(daily["weight"], days, last, history_days=params["history_days"])
        if sum(1 for m, _se, _n in rows if m is not None) >= 5:
            rhythm["weight"] = rows
    return {"z": params["z"], "historyDays": params["history_days"], "keys": keys, "weekday": rhythm}
