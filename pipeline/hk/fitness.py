"""VO2 max against people of the same age group and sex.

Apple Watch estimates VO2 max after outdoor walks, runs and hikes. Its Cardio Fitness
levels compare the estimate with the FRIEND registry's percentiles (directly measured
treadmill tests, 2015); this uses the same table, so the position matches what the Health
app shows, and says where in it the wearer's recent readings sit. The table and the
cut-offs are in reference.json (vo2max_peers).
"""
from __future__ import annotations


def percentile_of(value: float, row: list[float], percentiles: list[float]) -> tuple[float | None, str | None]:
    """(percentile, None) by linear interpolation between the table's columns, or
    (None, "below" / "above") outside the table's range."""
    if value < row[0]:
        return None, "below"
    if value > row[-1]:
        return None, "above"
    for k in range(len(row) - 1):
        if row[k] <= value <= row[k + 1]:
            span = row[k + 1] - row[k]
            share = 0 if span == 0 else (value - row[k]) / span
            return percentiles[k] + share * (percentiles[k + 1] - percentiles[k]), None
    return None, None


def value_at(percentile: float, row: list[float], percentiles: list[float]) -> float:
    """The table value at a percentile inside its range, by linear interpolation."""
    for k in range(len(percentiles) - 1):
        if percentiles[k] <= percentile <= percentiles[k + 1]:
            share = (percentile - percentiles[k]) / (percentiles[k + 1] - percentiles[k])
            return row[k] + share * (row[k + 1] - row[k])
    raise ValueError(percentile)


def vo2_peers(*, days: list[str], vo2: list, profile: dict, params: dict[str, dict]) -> dict | None:
    """Where the recent VO2 max readings sit among people of the same age group and sex.

    None without any reading. Otherwise the recent level (mean of the readings in the 30
    days up to the latest one) and, when age and sex are known and the reading is recent,
    the percentile, the range of percentiles the watch's typical error spans, the distance
    from the group's median in METs, and whether it is in Apple's "low" range. ``why``
    says what is missing when there is no comparison.
    """
    p = params["vo2max_peers"]
    readings = [(i, v) for i, v in enumerate(vo2) if v is not None]
    if not readings:
        return None
    last = readings[-1][0]
    recent = [v for i, v in readings if last - p["window_days"] < i <= last]
    level = sum(recent) / len(recent)
    out: dict = {"value": round(level, 1), "n": len(recent), "last": days[last], "readings": len(readings),
                 "age": profile.get("age"), "sex": profile.get("sex"), "pct": None, "side": None, "why": None}
    age, sex = profile.get("age"), profile.get("sex")
    if age is None or sex not in p["table"]:
        out["why"] = "profile"
        return out
    if age < p["min_age"]:
        out["why"] = "young"
        return out
    rows = p["table"][sex]
    decade = min(age // 10 * 10, rows[-1][0])
    row = next(r for a, r in rows if a == decade)
    pcts = p["percentiles"]
    median = row[pcts.index(50)]
    out.update(group=[decade, decade + 9], beyond=age >= rows[-1][0] + 10, row=row, percentiles=pcts,
               median=median, vsMedianMet=round((level - median) / p["met"], 1))
    if age >= p["low_from_age"]:
        line = p["low_abs"][sex]
    else:
        line = value_at(p["low_percentile"], row, pcts)
    out.update(lowLine=round(line, 1), low=level < line)
    if len(days) - 1 - last > p["stale_days"]:
        out["why"] = "stale"
        return out
    pct, side = percentile_of(level, row, pcts)
    err = p["device_error_sd"]
    lo, lo_side = percentile_of(level - err, row, pcts)
    hi, hi_side = percentile_of(level + err, row, pcts)
    out.update(pct=None if pct is None else round(pct), side=side,
               pctLo=None if lo is None else round(lo), loSide=lo_side,
               pctHi=None if hi is None else round(hi), hiSide=hi_side)
    return out
