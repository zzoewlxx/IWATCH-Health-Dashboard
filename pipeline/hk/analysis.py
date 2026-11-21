"""Derived daily series: personal baselines, sleep regularity, training load.

Every value is "as of" its day: day i uses data up to and including day i and nothing
later, so a past week reads the same no matter when it is looked at. Window lengths
and thresholds come from reference.json (see reference.py), not from this file.
"""
from __future__ import annotations

import math
from statistics import median

MINUTES = 1440
SLEEP_DAY_START = -360                 # a "sleep day" runs 18:00 -> 18:00, as in sleep.py
ASLEEP_CODES = (0, 1, 2, 3)            # deep, core, REM, unspecified (sleep.STAGE_CODE)
MEASURED = ("stages", "asleep")        # sleep kinds that are measured sleep, not an in-bed guess


def _vals(arr: list, lo: int, hi: int) -> list[float]:
    """Non-missing values of arr[lo..hi], both ends included, clipped to the data."""
    if hi < 0:
        return []
    return [v for v in arr[max(0, lo): hi + 1] if v is not None]


def _mean(xs: list[float]) -> float:
    return sum(xs) / len(xs)


def _sd(xs: list[float]) -> float:
    """Sample standard deviation (0 for fewer than two values)."""
    n = len(xs)
    if n < 2:
        return 0.0
    m = sum(xs) / n
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1))


def _round(xs: list, dec: int) -> list:
    if dec == 0:
        return [None if v is None else int(round(v)) for v in xs]
    return [None if v is None else round(v, dec) for v in xs]


def _exp(v: float | None) -> float | None:
    return None if v is None else math.exp(v)


# ---------------------------------------------------------------------------------------
# recovery
# ---------------------------------------------------------------------------------------

def recent_vs_baseline(values: list, *, recent_days: int, min_recent: int, baseline_days: int,
                       min_baseline: int, min_sd: float, log: bool = False):
    """Mean of the last ``recent_days`` against the ``baseline_days`` before them.

    Returns four per-day lists: recent mean, baseline mean, baseline SD, and
    z = (recent - baseline) / SD. The baseline never overlaps the recent days, so a
    change is always measured against what came before it. With ``log`` the statistics
    are taken on ln(x); the caller converts the means back with exp().
    """
    n = len(values)
    x = [math.log(v) if v is not None and v > 0 else None for v in values] if log else values
    recent: list = [None] * n
    base: list = [None] * n
    sd: list = [None] * n
    z: list = [None] * n
    for i in range(n):
        r = _vals(x, i - recent_days + 1, i)
        b = _vals(x, i - recent_days - baseline_days + 1, i - recent_days)
        if len(r) >= min_recent:
            recent[i] = _mean(r)
        if len(b) >= min_baseline:
            base[i] = _mean(b)
            sd[i] = max(_sd(b), min_sd)
        if recent[i] is not None and base[i] is not None:
            z[i] = (recent[i] - base[i]) / sd[i]
    return recent, base, sd, z


def night_outliers(daily: dict[str, list], n: int, p: dict):
    """Each night's overnight signals against the nights before it.

    Returns (z, evaluable, outliers): z[key][i] is how many SDs night i sits from the
    mean of the preceding ``baseline_days``; ``evaluable[i]`` is how many signals could
    be compared that night (None when fewer than ``min_signals``); ``outliers[i]`` counts
    those at least ``outlier_sd`` away in the unfavourable direction.
    """
    zs: dict[str, list] = {}
    worse_sign: dict[str, int] = {}
    for key, spec in p["signals"].items():
        raw = daily.get(key) or [None] * n
        x = [math.log(v) if v is not None and v > 0 else None for v in raw] if spec.get("log") else raw
        z: list = [None] * n
        for i in range(n):
            if x[i] is None:
                continue
            b = _vals(x, i - p["baseline_days"], i - 1)
            if len(b) >= p["min_baseline"]:
                z[i] = (x[i] - _mean(b)) / max(_sd(b), spec["min_sd"])
        zs[key] = z
        worse_sign[key] = 1 if spec["worse"] == "high" else -1
    evaluable: list = [None] * n
    outliers: list = [None] * n
    for i in range(n):
        got = [worse_sign[k] * zs[k][i] for k in zs if zs[k][i] is not None]
        if len(got) >= p["min_signals"]:
            evaluable[i] = len(got)
            outliers[i] = sum(1 for v in got if v >= p["outlier_sd"])
    return zs, evaluable, outliers


# ---------------------------------------------------------------------------------------
# sleep
# ---------------------------------------------------------------------------------------

def sleep_regularity(n: int, kind: list, segments: list, *, pairs: int, min_pairs: int) -> list:
    """Sleep Regularity Index (Phillips et al. 2017) over the last ``pairs`` day pairs.

    For two consecutive days, compare minute by minute whether the wearer was asleep at
    the same clock time; the index is -100 + 200 x (share of matching minutes), so
    identical days give 100 and unrelated ones about 0. A pair counts only when both
    nights have measured sleep, so nights the watch was off do not look like wakefulness.
    """
    same = _matching_minutes(n, kind, segments)
    out: list = [None] * n
    for i in range(n):
        got = [s for s in same[max(1, i - pairs + 1): i + 1] if s is not None]
        if len(got) >= min_pairs:
            out[i] = -100 + 200 * sum(got) / (MINUTES * len(got))
    return out


def _matching_minutes(n: int, kind: list, segments: list) -> list:
    """same[j]: minutes (out of 1440) in which day j and day j-1 were in the same state."""
    line = bytearray((n + 3) * MINUTES)              # one byte per minute, 1 = asleep
    for d, segs in segments:
        base = (d + 1) * MINUTES                     # +1 day: a night starts before midnight
        for a, b, code in segs:
            lo, hi = max(0, base + a), min(len(line), base + b)
            if code in ASLEEP_CODES and hi > lo:
                line[lo:hi] = b"\x01" * (hi - lo)
    same: list = [None] * n
    for j in range(1, n):
        if kind[j] in MEASURED and kind[j - 1] in MEASURED:
            s = (j + 1) * MINUTES + SLEEP_DAY_START
            cur = int.from_bytes(line[s: s + MINUTES], "big")
            prev = int.from_bytes(line[s - MINUTES: s], "big")
            same[j] = MINUTES - bin(cur ^ prev).count("1")
    return same


def sleep_series(daily: dict[str, list], kind: list, segments: list, need: float, P: dict) -> dict[str, list]:
    total, bed = daily["sleepTotal"], daily["bedtime"]
    n = len(total)
    dur, debt, reg, var = P["sleep_duration"], P["sleep_debt"], P["sleep_regularity"], P["sleep_timing_variability"]
    sleep7: list = [None] * n
    short7: list = [None] * n
    debt14: list = [None] * n
    bed_sd: list = [None] * n
    dur_sd: list = [None] * n
    for i in range(n):
        w = _vals(total, i - dur["window_days"] + 1, i)
        if len(w) >= dur["min_nights"]:
            sleep7[i] = _mean(w)
            short7[i] = sum(1 for v in w if v < dur["short_night_hours"])
        w = _vals(total, i - debt["window_days"] + 1, i)
        if len(w) >= debt["min_nights"]:
            debt14[i] = sum(need - v for v in w)
        nights = [j for j in range(max(0, i - var["window_days"] + 1), i + 1)
                  if total[j] is not None and bed[j] is not None]
        if len(nights) >= var["min_nights"]:
            bed_sd[i] = _sd([bed[j] for j in nights])
            # The day's whole sleep, naps included: a night broken by a long waking spell is
            # stored as a main sleep plus a "nap", and should not read as a very short night.
            dur_sd[i] = _sd([total[j] * 60 for j in nights])
    return {
        "sleep7": _round(sleep7, 2),
        "shortNights7": short7,
        "sleepDebt14": _round(debt14, 1),
        "sri7": _round(sleep_regularity(n, kind, segments, pairs=reg["week_days"], min_pairs=reg["min_pairs_week"]), 1),
        "sri28": _round(sleep_regularity(n, kind, segments, pairs=reg["window_days"], min_pairs=reg["min_pairs"]), 1),
        "bedSd7": _round(bed_sd, 0),
        "durSd7": _round(dur_sd, 0),
    }


# ---------------------------------------------------------------------------------------
# training and activity
# ---------------------------------------------------------------------------------------

def workout_loads(workouts: list[dict], default_effort: float) -> list[tuple[int, bool]]:
    """(load, estimated) per workout, in the order given (which must be chronological).

    Load is effort (1-10) x minutes. A workout without an effort rating borrows the
    median rating of earlier workouts of the same type, then of any type, then the
    default; ``estimated`` marks those.
    """
    by_type: dict[str, list[float]] = {}
    every: list[float] = []
    out: list[tuple[int, bool]] = []
    for w in workouts:
        effort = w.get("effort")
        estimated = effort is None
        if estimated:
            prior = by_type.get(w["key"]) or every
            effort = median(prior) if prior else default_effort
        else:
            by_type.setdefault(w["key"], []).append(effort)
            every.append(effort)
        out.append((int(round(effort * w["min"])), estimated))
    return out


def training_series(n: int, workouts: list[dict], loads: list[tuple[int, bool]], P: dict) -> dict[str, list]:
    p, strength_types = P["training_load"], set(P["strength_days"]["types"])
    acute, chronic = p["acute_days"], p["chronic_days"]
    day_load = [0.0] * n
    trained = [False] * n
    strength = [False] * n
    for w, (value, _est) in zip(workouts, loads):
        day_load[w["d"]] += value
        trained[w["d"]] = True
        if w["key"] in strength_types:
            strength[w["d"]] = True
    first = min((w["d"] for w in workouts), default=None)
    load: list = [None] * n
    load7: list = [None] * n
    base: list = [None] * n
    ratio: list = [None] * n
    since: list = [None] * n
    strength7: list = [None] * n
    last = None
    for i in range(n):
        if first is None or i < first:
            continue                                  # nothing was being recorded yet
        if trained[i]:
            last = i
        load[i] = day_load[i]
        since[i] = i - last
        load7[i] = sum(day_load[max(0, i - acute + 1): i + 1])
        strength7[i] = sum(strength[max(0, i - P["strength_days"]["window_days"] + 1): i + 1])
        start = i - acute - chronic + 1
        if start >= first:                            # the whole comparison period is on record
            base[i] = sum(day_load[start: i - acute + 1]) * 7 / chronic
            if base[i] >= p["min_chronic_weekly"]:
                ratio[i] = load7[i] / base[i]
    return {
        "load": _round(load, 0), "load7": _round(load7, 0), "loadBase": _round(base, 0),
        "loadRatio": _round(ratio, 2), "daysSinceWorkout": since, "strengthDays7": strength7,
    }


def rolling_mean(values: list, days: int, min_days: int) -> list:
    out: list = [None] * len(values)
    for i in range(len(values)):
        w = _vals(values, i - days + 1, i)
        if len(w) >= min_days:
            out[i] = _mean(w)
    return out


# ---------------------------------------------------------------------------------------
# everything together
# ---------------------------------------------------------------------------------------

def build_analysis(*, days: list[str], daily: dict[str, list], sleep_kind: list, sleep_segments: list,
                   workouts: list[dict], params: dict[str, dict], sleep_need: float | None = None) -> dict:
    """All derived series for the dashboard and health.db.

    ``params`` is reference.params_by_id(...). Returns
    {"params": {...}, "daily": {key: [per day]}, "workoutLoad": [(load, estimated)]}.
    """
    P = params
    n = len(days)
    out: dict[str, list] = {}

    h = P["hrv_night"]
    recent, base, sd, z = recent_vs_baseline(
        daily["sleepHrv"], recent_days=h["recent_days"], min_recent=h["min_recent"],
        baseline_days=h["baseline_days"], min_baseline=h["min_baseline"], min_sd=h["min_sd"], log=True)
    out["hrv7"] = _round([_exp(v) for v in recent], 1)
    out["hrvBase"] = _round([_exp(v) for v in base], 1)
    out["hrvLo"] = _round([None if b is None else math.exp(b - h["band_sd"] * s) for b, s in zip(base, sd)], 1)
    out["hrvHi"] = _round([None if b is None else math.exp(b + h["band_sd"] * s) for b, s in zip(base, sd)], 1)
    out["hrvZ"] = _round(z, 2)

    r = P["rhr"]
    recent, base, sd, z = recent_vs_baseline(
        daily["rhr"], recent_days=r["recent_days"], min_recent=r["min_recent"],
        baseline_days=r["baseline_days"], min_baseline=r["min_baseline"], min_sd=r["min_sd"])
    out["rhr7"] = _round(recent, 1)
    out["rhrBase"] = _round(base, 1)
    out["rhrHi"] = _round([None if b is None else b + r["high_sd"] * s for b, s in zip(base, sd)], 1)
    out["rhrZ"] = _round(z, 2)

    zs, evaluable, outliers = night_outliers(daily, n, P["night_vitals"])
    for key, series in zs.items():
        out["z" + key[0].upper() + key[1:]] = _round(series, 1)
    out["vitalsN"] = evaluable
    out["vitalsOut"] = outliers

    # A night whose record was probably cut short says nothing reliable about how long the
    # wearer slept, so it is treated like a night without data.
    cut = daily.get("sleepCut") or [None] * n
    whole = dict(daily, sleepTotal=[None if c else v for v, c in zip(daily["sleepTotal"], cut)])
    kind = [None if c else k for k, c in zip(sleep_kind, cut)]
    need = P["sleep_debt"]["need_hours"] if sleep_need is None else sleep_need
    out.update(sleep_series(whole, kind, sleep_segments, need, P))

    loads = workout_loads(workouts, P["training_load"]["default_effort"])
    out.update(training_series(n, workouts, loads, P))

    a, s = P["activity_minutes"], P["steps"]
    # Exercise minutes come from the watch: a day it was hardly worn is unknown, not zero.
    wear = daily.get("wear") or [None] * n
    worn = [None if w is not None and w < a["min_wear_percent"] else v for v, w in zip(daily["exerciseMin"], wear)]
    weekly = rolling_mean(worn, a["window_days"], a["min_days"])
    out["exercise7"] = _round([None if v is None else v * a["window_days"] for v in weekly], 0)
    out["steps7"] = _round(rolling_mean(daily["steps"], s["window_days"], s["min_days"]), 0)

    return {"params": {"sleepNeed": need}, "daily": out, "workoutLoad": loads}


def series_info(params: dict[str, dict], sleep_need: float) -> dict[str, tuple[str, str]]:
    """key -> (label, unit) for every series build_analysis returns (the data dictionary)."""
    P = params
    h, r, v, d = P["hrv_night"], P["rhr"], P["night_vitals"], P["sleep_duration"]
    debt, reg, var, t = P["sleep_debt"], P["sleep_regularity"], P["sleep_timing_variability"], P["training_load"]
    night = f"当晚相对此前 {v['baseline_days']} 天偏离的标准差数"
    return {
        "hrv7": (f"夜间 HRV：近 {h['recent_days']} 晚均值", "ms"),
        "hrvBase": (f"夜间 HRV：个人基线（再往前 {h['baseline_days']} 天）", "ms"),
        "hrvLo": (f"夜间 HRV：平稳带下沿（基线 − {h['band_sd']} 个标准差）", "ms"),
        "hrvHi": (f"夜间 HRV：平稳带上沿（基线 + {h['band_sd']} 个标准差）", "ms"),
        "hrvZ": ("夜间 HRV：近期均值偏离基线的标准差数", ""),
        "rhr7": (f"静息心率：近 {r['recent_days']} 天均值", "bpm"),
        "rhrBase": (f"静息心率：个人基线（再往前 {r['baseline_days']} 天）", "bpm"),
        "rhrHi": (f"静息心率：明显偏高的界线（基线 + {r['high_sd']} 个标准差）", "bpm"),
        "rhrZ": ("静息心率：近期均值偏离基线的标准差数", ""),
        "zSleepHr": ("睡眠心率：" + night, ""),
        "zSleepHrv": ("睡眠 HRV：" + night, ""),
        "zResp": ("睡眠呼吸频率：" + night, ""),
        "zWristTemp": ("手腕温度：" + night, ""),
        "zSleepSpo2": ("睡眠血氧：" + night, ""),
        "vitalsN": ("当晚可以比较的夜间体征项数", "项"),
        "vitalsOut": (f"当晚向不利方向偏离 {v['outlier_sd']} 个标准差以上的夜间体征项数", "项"),
        "sleep7": (f"睡眠时长：近 {d['window_days']} 天平均", "小时"),
        "shortNights7": (f"近 {d['window_days']} 天里不足 {d['short_night_hours']} 小时的晚数", "晚"),
        "sleepDebt14": (f"近 {debt['window_days']} 天睡眠欠账（按每晚需要 {sleep_need:g} 小时；正数为欠，负数为盈余）", "小时"),
        "sri7": (f"作息规律指数：近 {reg['week_days']} 对相邻日", ""),
        "sri28": (f"作息规律指数：近 {reg['window_days']} 对相邻日", ""),
        "bedSd7": (f"入睡时间的标准差：近 {var['window_days']} 晚", "分钟"),
        "durSd7": (f"每日睡眠时长的标准差：近 {var['window_days']} 晚", "分钟"),
        "load": ("当日训练负荷（费力度 × 分钟）", ""),
        "load7": (f"训练负荷：近 {t['acute_days']} 天合计", ""),
        "loadBase": (f"训练负荷：再往前 {t['chronic_days']} 天的周均", ""),
        "loadRatio": ("训练负荷：近期合计 ÷ 此前周均", "倍"),
        "daysSinceWorkout": ("距离上次训练的天数", "天"),
        "strengthDays7": (f"近 {P['strength_days']['window_days']} 天里有力量训练的天数", "天"),
        "exercise7": (f"锻炼分钟：近 {P['activity_minutes']['window_days']} 天合计", "分钟"),
        "steps7": (f"步数：近 {P['steps']['window_days']} 天日均", "步"),
    }
