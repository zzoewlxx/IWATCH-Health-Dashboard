"""Looking back over the whole record: what a different threshold would have changed, and
how the flagged nights line up with the wearer's own annotations.

This is what makes the thresholds in reference.json adjustable with open eyes: before
changing one, see how many weeks (or nights) each choice would have spoken up.
"""
from __future__ import annotations

import copy

from .analysis import _mean, hr_episodes, night_hr_runs, night_outliers
from .report import build_reports

# (indicator, parameter, values to try, id of the suggestion it drives, what the count means)
TIP_VARIANTS = [
    ("hrv_night", "low_run_days", [1, 2, 3, 5], "hrv_low", "夜间 HRV 连续几天低于平稳带才提示"),
    ("sleep_duration", "short_week_mean_hours", [6, 6.5, 7], "sleep_short", "7 天平均睡眠低于几小时算偏少"),
    ("sleep_timing_variability", "onset_sd_high", [60, 90, 120], "sleep_irregular", "入睡时间的波动超过几分钟算不规律"),
    ("steps", "low", [4000, 5000, 6000, 7000], "steps_low", "日均步数低于多少提示多走"),
    ("training_load", "high_ratio", [1.3, 1.5, 2.0], "load_up", "训练负荷超过此前周均的几倍算加量快"),
]


def _sundays(reports: list[dict]) -> list[dict]:
    return [r for r in reports if r["sunday"]]


def sensitivity(*, days: list[str], daily: dict[str, list], analysis: dict[str, list], workouts: list[dict],
                params: dict[str, dict], scores: dict, sleep_need: float) -> dict:
    """How often each rule would have fired under nearby thresholds.

    Returns {"reports": Sunday reports, "nights": nights that could be judged, "variants": [...]};
    each variant lists [{value, count, current}] with ``current`` marking the value in use.
    """
    n = len(days)
    base = _sundays(build_reports(days=days, daily=daily, analysis=analysis, workouts=workouts, params=params, scores=scores))
    variants = []

    p = params["night_vitals"]
    rows = []
    judged = 0
    for value in (1.5, 2.0, 2.5, 3.0):
        _z, evaluable, outliers = night_outliers(daily, n, dict(p, outlier_sd=value))
        judged = sum(1 for v in evaluable if v is not None)
        rows.append({"value": value, "count": sum(1 for v in outliers if v is not None and v >= p["min_outliers"]),
                     "current": value == p["outlier_sd"]})
    variants.append({"indicator": "night_vitals", "label": "夜间体征偏离几个标准差才算数", "counts": "被标出的夜晚",
                     "unit": "晚", "of": judged, "rows": rows})

    h = params["night_hr_rise"]
    rows = []
    for value in (3, 4, 5, 6):
        _base, _rise, run = night_hr_runs(daily.get("sleepHr") or [None] * n, baseline_nights=h["baseline_nights"],
                                          min_baseline=h["min_baseline"], rise_bpm=value,
                                          max_gap_nights=h["max_gap_nights"])
        hr_judged = sum(1 for v in run if v is not None)
        rows.append({"value": value, "count": sum(1 for v in run if v is not None and v >= h["min_nights"]),
                     "current": value == h["rise_bpm"]})
    variants.append({"indicator": "night_hr_rise", "label": f"睡眠心率高出平时几次/分算偏高（连续 {h['min_nights']} 晚才提示）",
                     "counts": "提示的夜晚", "unit": "晚", "of": hr_judged, "rows": rows})

    for indicator, key, values, tip, label in TIP_VARIANTS:
        rows = []
        for value in values:
            changed = copy.deepcopy(params)
            changed[indicator][key] = value
            reports = base if value == params[indicator][key] else _sundays(build_reports(
                days=days, daily=daily, analysis=analysis, workouts=workouts, params=changed, scores=scores))
            rows.append({"value": value, "count": sum(1 for r in reports if any(t["id"] == tip for t in r["tips"])),
                         "current": value == params[indicator][key]})
        variants.append({"indicator": indicator, "label": label, "counts": "给出这条建议的期数",
                         "unit": "期", "of": len(base), "rows": rows})

    # Sleep need is a setting rather than a threshold, but the "debt" figure hangs on it entirely.
    debt = params["sleep_debt"]
    cut = daily.get("sleepCut") or [None] * n
    total = [None if c else v for v, c in zip(daily["sleepTotal"], cut)]
    rows = []
    for need in (7, 7.5, 8, 8.5):
        count = 0
        for r in base:
            w = [v for v in total[max(0, r["end"] - debt["window_days"] + 1): r["end"] + 1] if v is not None]
            if len(w) >= debt["min_nights"] and sum(need - v for v in w) >= debt["note_hours"]:
                count += 1
        rows.append({"value": need, "count": count, "current": need == sleep_need})
    variants.append({"indicator": "sleep_debt", "label": f"按每晚需要睡几小时算，两周欠账超过 {debt['note_hours']:g} 小时",
                     "counts": "欠账超过这条线的期数", "unit": "期", "of": len(base), "rows": rows})
    return {"reports": len(base), "nights": judged, "variants": variants}


def annotation_check(annotations: list[dict], analysis: dict[str, list], params: dict[str, dict]) -> dict:
    """Flagged nights against the wearer's own notes.

    A note on day d is compared with the nights recorded on d and d+1 (an evening's drinking
    shows in the night that ends the next morning), so a flagged night looks for notes on its
    own day and the day before.
    """
    p = params["night_vitals"]
    out = analysis["vitalsOut"]
    n = len(out)
    by_day = {e["d"]: e for e in annotations}
    is_flagged = lambda j: 0 <= j < n and out[j] is not None and out[j] >= p["min_outliers"]      # noqa: E731
    judged = lambda j: 0 <= j < n and out[j] is not None                                           # noqa: E731

    flagged = []
    for j in range(n):
        if is_flagged(j):
            notes = [by_day[d] for d in (j - 1, j) if d in by_day]
            flagged.append({"d": j, "tags": [t for e in notes for t in e["tags"]],
                            "note": "；".join(e["note"] for e in notes if e["note"])})

    # the second overnight rule: runs of nights with sleeping heart rate above usual
    h = params["night_hr_rise"]
    run, rise = analysis.get("hrRun") or [None] * n, analysis.get("hrRise") or [None] * n
    high = lambda j: 0 <= j < n and rise[j] is not None and rise[j] >= h["rise_bpm"] - 1e-9   # noqa: E731
    runs = []
    for e in hr_episodes(run, rise, analysis.get("hrBase") or [None] * n, min_nights=h["min_nights"],
                         max_gap_nights=h["max_gap_nights"]):
        notes = [by_day[d] for d in range(e["start"] - 1, e["end"] + 1) if d in by_day]
        runs.append({"start": e["start"], "end": e["end"], "nights": e["nights"], "rise": e["rise"],
                     "tags": [t for x in notes for t in x["tags"]], "note": "；".join(x["note"] for x in notes if x["note"])})

    tags: dict[str, dict] = {}
    for e in annotations:
        d = e["d"]
        for tag in e["tags"] or ["（只有备注）"]:
            t = tags.setdefault(tag, {"tag": tag, "days": 0, "judged": 0, "hits": 0, "hrJudged": 0, "hrHits": 0,
                                      "z": {k: [] for k in p["signals"]}})
            t["days"] += 1
            if judged(d) or judged(d + 1):
                t["judged"] += 1
                t["hits"] += is_flagged(d) or is_flagged(d + 1)
            if any(0 <= j < n and rise[j] is not None for j in (d, d + 1)):
                t["hrJudged"] += 1
                t["hrHits"] += high(d) or high(d + 1)
            for key in p["signals"]:
                series = analysis["z" + key[0].upper() + key[1:]]
                t["z"][key] += [series[j] for j in (d, d + 1) if 0 <= j < n and series[j] is not None]
    rows = []
    for t in sorted(tags.values(), key=lambda t: -t["days"]):
        rows.append({"tag": t["tag"], "days": t["days"], "judged": t["judged"], "hits": int(t["hits"]),
                     "hrJudged": t["hrJudged"], "hrHits": int(t["hrHits"]),
                     "z": {k: round(_mean(v), 1) if len(v) >= 3 else None for k, v in t["z"].items()}})
    return {"annotated": len(annotations), "flagged": flagged, "hrRuns": runs, "tags": rows}
