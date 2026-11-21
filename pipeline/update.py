"""One-shot update: newest Apple Health export -> dashboard/data.js

Usage:  python pipeline/update.py [--data 数据集] [--export <folder-or-zip>] [--no-open]
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import webbrowser
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hk import tz as tzmod                                           # noqa: E402
from hk.analysis import build_analysis, series_info                   # noqa: E402
from hk.annotations import read_annotations                           # noqa: E402
from hk.backtest import annotation_check, sensitivity                 # noqa: E402
from hk.daily import (daily_stat, daily_sum, dominant_source, heart_rate_daily,  # noqa: E402
                      heart_rate_minutes, hourly_sum, resolve_overlaps, source_rank, source_runs)
from hk.extras import build_ecgs, build_workouts                      # noqa: E402
from hk.parse import export_offset, parse_export, parse_ts            # noqa: E402
from hk.reference import load_reference, params_by_id                 # noqa: E402
from hk.report import build_reports                                   # noqa: E402
from hk.sleep import DAY_SHIFT, build_nights                          # noqa: E402
from hk.source import ExportSource, find_exports                      # noqa: E402
from hk.sqlite_out import write_db                                    # noqa: E402
from hk.tz import DAY, EnergyIndex, build_timeline, ts_date           # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

# key -> (HealthKit type, decimals)   summed per day after source de-duplication
SUMS = {
    "steps": ("StepCount", 0),
    "distance": ("DistanceWalkingRunning", 2),
    "cycling": ("DistanceCycling", 2),
    "activeKcalRec": ("ActiveEnergyBurned", 0),
    "basalKcal": ("BasalEnergyBurned", 0),
    "flights": ("FlightsClimbed", 0),
    "exerciseRec": ("AppleExerciseTime", 0),
    "daylight": ("TimeInDaylight", 0),
    "water": ("DietaryWater", 0),
}
# key -> (type, aggregation, decimals, day shift seconds, use end time)
STATS = {
    "rhr": ("RestingHeartRate", "mean", 1, 0, False),
    "hrv": ("HeartRateVariabilitySDNN", "mean", 1, 0, False),
    "walkHr": ("WalkingHeartRateAverage", "mean", 1, 0, False),
    "resp": ("RespiratoryRate", "mean", 1, DAY_SHIFT, False),
    "spo2": ("OxygenSaturation", "mean", 1, 0, False),
    "spo2Min": ("OxygenSaturation", "min", 0, 0, False),
    "vo2max": ("VO2Max", "last", 1, 0, False),
    "weight": ("BodyMass", "mean", 2, 0, False),
    "bodyFat": ("BodyFatPercentage", "mean", 1, 0, False),
    "lean": ("LeanBodyMass", "mean", 2, 0, False),
    "bmi": ("BodyMassIndex", "mean", 1, 0, False),
    "wristTemp": ("AppleSleepingWristTemperature", "mean", 2, 0, True),
    "breathDist": ("AppleSleepingBreathingDisturbances", "mean", 1, 0, True),
    "walkSpeed": ("WalkingSpeed", "mean", 2, 0, False),
    "stepLen": ("WalkingStepLength", "mean", 1, 0, False),
    "dblSupport": ("WalkingDoubleSupportPercentage", "mean", 1, 0, False),
    "asym": ("WalkingAsymmetryPercentage", "mean", 1, 0, False),
    "steadiness": ("AppleWalkingSteadiness", "mean", 1, 0, False),
    "sixMin": ("SixMinuteWalkTestDistance", "last", 0, 0, False),
    "stairUp": ("StairAscentSpeed", "mean", 2, 0, False),
    "stairDown": ("StairDescentSpeed", "mean", 2, 0, False),
    "headphone": ("HeadphoneAudioExposure", "dbmean", 1, 0, False),
}
PERCENT_TYPES = ("OxygenSaturation", "BodyFatPercentage", "WalkingDoubleSupportPercentage",
                 "WalkingAsymmetryPercentage", "AppleWalkingSteadiness")
SLEEP_DECIMALS = {"sleepTotal": 2, "sleepDeep": 2, "sleepCore": 2, "sleepRem": 2, "sleepUnspec": 2,
                  "sleepAwake": 0, "sleepInBed": 2, "sleepNap": 2, "bedtime": 0, "waketime": 0,
                  "sleepEff": 1, "wakeCount": 0, "sleepHr": 1, "sleepHrLow": 1, "sleepHrv": 1,
                  "sleepSpo2": 1, "deepPct": 1, "remPct": 1, "corePct": 1, "sleepCut": 0}
# All-day totals that are incomplete on the day the export was made.
PARTIAL_KEYS = ("steps", "distance", "cycling", "activeKcal", "basalKcal", "totalKcal", "flights",
                "exerciseMin", "standHours", "daylight", "water", "hrMin", "hrMax", "hrAvg", "wear")


def say(msg: str) -> None:
    print(msg, flush=True)


def rnd(values: list, dec: int) -> list:
    if dec == 0:
        return [None if v is None else int(round(v)) for v in values]
    return [None if v is None else round(v, dec) for v in values]


def load_config() -> dict:
    p = ROOT / "config.json"
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        say(f"  ! config.json 读取失败（{exc}），使用默认设置")
        return {}


def sleep_need_setting(cfg: dict, default: float) -> float:
    """Hours of sleep the wearer needs per night: config.json, or the table's default."""
    value = cfg.get("sleep_need_hours")
    if value is None:
        return float(default)
    if isinstance(value, (int, float)) and not isinstance(value, bool) and 4 <= value <= 12:
        return float(value)
    say(f"  ! config.json 的 sleep_need_hours 应是 4 到 12 之间的数字（现在是 {value!r}），按 {default:g} 小时计算")
    return float(default)


def pick_export(data_dir: Path, explicit: str | None) -> ExportSource:
    if explicit:
        p = Path(explicit)
        found = find_exports(p if p.is_dir() else p.parent)
        found = [s for s in found if s.path == p or p in s.path.parents or s.path == p.parent] or found
    else:
        found = find_exports(data_dir)
    if not found:
        raise SystemExit(f"在 {explicit or data_dir} 下没有找到 Apple 健康导出（export.xml / 导出.xml 或导出 zip）。")
    say(f"找到 {len(found)} 份导出：")
    for i, s in enumerate(found):
        say(f"  {'→' if i == 0 else ' '} {s.export_date or '未知日期'}  {s.path}")
    return found[0]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", default=None, help="放导出文件的目录（默认：数据集）")
    ap.add_argument("--export", default=None, help="直接指定某一份导出（文件夹或 zip）")
    ap.add_argument("--no-open", action="store_true", help="完成后不自动打开看板")
    ap.add_argument("--no-db", action="store_true", help="不生成 health.db（SQLite 数据库）")
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(errors="replace")
    except AttributeError:
        pass

    t_start = time.time()
    cfg = load_config()
    data_dir = Path(args.data) if args.data else ROOT / cfg.get("data_dir", "数据集")
    src = pick_export(data_dir, args.export)

    say("解析导出文件…")
    with src.open_main() as fp:
        store = parse_export(fp, progress=lambda n: say(f"  已读取 {n:,} 条"))
    n_records = sum(v["n"] for v in store.inventory.values())
    say(f"  共 {n_records:,} 条记录、{len(store.workouts)} 次训练、{len(store.activity)} 天活动汇总")
    if not store.export_date:
        raise SystemExit("导出文件里没有 ExportDate，无法继续。")

    q, cat = store.quantity, store.category
    for t in PERCENT_TYPES:                       # Apple writes percentages as fractions
        if q.get(t) and max(r[2] for r in q[t]) <= 1.0:
            q[t] = [(s, e, v * 100, sr) for s, e, v, sr in q[t]]

    export_ts = parse_ts(store.export_date)
    exp_off = export_offset(store.export_date)
    rank = source_rank(store.sources, cfg.get("source_priority"))

    say("多来源去重…")
    resolved = {key: resolve_overlaps(q.get(t, []), rank) for key, (t, _) in SUMS.items()}

    say("还原时区…")
    summary_kcal = {}
    for a in store.activity:
        try:
            summary_kcal[a["dateComponents"]] = float(a.get("activeEnergyBurned") or 0)
        except ValueError:
            pass
    first_ts = min((recs[0][0] for recs in resolved.values() if recs), default=export_ts)
    for t in ("HeartRate", "BodyMass"):
        if q.get(t):
            first_ts = min(first_ts, min(r[0] for r in q[t]))
    tl = build_timeline(store.tz_hints, first_ts, export_ts, exp_off,
                        EnergyIndex(resolved["activeKcalRec"]), summary_kcal,
                        cfg.get("timezone_overrides"))
    tz_desc = tl.describe(first_ts, export_ts)
    for seg in tz_desc:
        how = {"metadata": "记录", "inferred": "推断", "override": "手动", "default": "默认"}.get(seg["how"], seg["how"])
        say(f"  {seg['from']} → {seg['to']}  {seg['tz']}（{how}）")

    day0 = tl.local_day(first_ts)
    ndays = tl.local_day(export_ts) - day0 + 1
    days = [ts_date((day0 + i) * DAY) for i in range(ndays)]
    day_index = {d: i for i, d in enumerate(days)}

    say("按天汇总…")
    daily: dict[str, list] = {}
    eras: dict[str, list] = {}
    for key, (t, dec) in SUMS.items():
        vals, per_src = daily_sum(resolved[key], tl, day0, ndays, by_src=True)
        daily[key] = rnd(vals, dec)
        dom = [max(m, key=m.get) if m else None for m in per_src]
        eras[key] = source_runs(dom, store.sources, days, min_run=14)
    for key, (t, agg, dec, shift, use_end) in STATS.items():
        recs = q.get(t, [])
        daily[key] = rnd(daily_stat(recs, tl, day0, ndays, agg, shift, use_end), dec)
        eras[key] = source_runs(dominant_source(recs, tl, day0, ndays, shift), store.sources, days)

    # --- activity rings: Apple's own daily summary is authoritative where it exists ---
    watch_day = [False] * ndays                    # the watch logs a stand sample every worn hour
    stand_rec = [0] * ndays
    for s, _e, val, _sr, _tz in cat.get("AppleStandHour", []):
        d = tl.local_day(s) - day0
        if 0 <= d < ndays:
            watch_day[d] = True
            stand_rec[d] += val == "Stood"
    # No stairs / daylight sample on a day the device was clearly in use means zero, not "unknown".
    daily["flights"] = [0 if v is None and s is not None else v for v, s in zip(daily["flights"], daily["steps"])]
    daily["daylight"] = [0 if v is None and worn else v for v, worn in zip(daily["daylight"], watch_day)]
    for key in ("activeKcal", "moveGoal", "exerciseMin", "exerciseGoal", "standHours", "standGoal"):
        daily[key] = [None] * ndays
    check_pairs = []
    for a in store.activity:
        d = day_index.get(a.get("dateComponents", ""))
        if d is None:
            continue

        def num(k: str) -> float | None:
            try:
                return float(a[k])
            except (KeyError, ValueError):
                return None

        kcal, rec = num("activeEnergyBurned"), daily["activeKcalRec"][d]
        if kcal is not None and (kcal > 0 or rec is None):
            daily["activeKcal"][d] = round(kcal)
            if rec is not None and kcal >= 50 and days[d] != days[-1]:
                check_pairs.append((d, kcal, rec))
        goal = num("activeEnergyBurnedGoal")
        if goal:
            daily["moveGoal"][d] = round(goal)
        if watch_day[d]:
            ex, st = num("appleExerciseTime"), num("appleStandHours")
            daily["exerciseMin"][d] = round(ex) if ex is not None else None
            daily["standHours"][d] = round(st) if st is not None else None
            daily["exerciseGoal"][d] = round(num("appleExerciseTimeGoal") or 0) or None
            daily["standGoal"][d] = round(num("appleStandHoursGoal") or 0) or None
    for d in range(ndays):                         # days the summary does not cover
        if daily["activeKcal"][d] is None:
            daily["activeKcal"][d] = daily["activeKcalRec"][d]
        if watch_day[d]:
            if daily["exerciseMin"][d] is None:
                daily["exerciseMin"][d] = daily["exerciseRec"][d] or 0
            if daily["standHours"][d] is None:
                daily["standHours"][d] = stand_rec[d]
    eras["activeKcal"] = eras.pop("activeKcalRec")
    eras["exerciseMin"] = eras.pop("exerciseRec")
    eras["standHours"] = eras["exerciseMin"]
    del daily["activeKcalRec"], daily["exerciseRec"]

    daily["totalKcal"] = [a + b if a is not None and b is not None else None
                          for a, b in zip(daily["activeKcal"], daily["basalKcal"])]
    daily["fatMass"] = [round(w * f / 100, 2) if w is not None and f is not None else None
                        for w, f in zip(daily["weight"], daily["bodyFat"])]
    eras["fatMass"] = eras["bodyFat"]
    eras["totalKcal"] = eras["basalKcal"]

    say("心率…")
    hr = q.get("HeartRate", [])
    lo, hi, avg, coverage, hourly = heart_rate_daily(hr, tl, day0, ndays)
    daily["hrMin"], daily["hrMax"], daily["hrAvg"] = rnd(lo, 0), rnd(hi, 0), rnd(avg, 1)
    # how much of the day has any heart-rate reading: a stand-in for "was the watch on?"
    daily["wear"] = rnd([None if c is None else 100 * c for c in coverage], 0)
    hr_era = source_runs(dominant_source(hr, tl, day0, ndays), store.sources, days)
    for k in ("hrMin", "hrMax", "hrAvg", "wear"):
        eras[k] = hr_era
    hr_hourly = [None if h is None else [None if v is None else round(v) for v in h] for h in hourly]
    intraday = {"hr": heart_rate_minutes(hr, tl, day0, ndays),
                "steps": hourly_sum(resolved["steps"], tl, day0, ndays)}

    say("睡眠…")
    reference = load_reference()
    ref_params = params_by_id(reference)
    nights = build_nights(cat.get("SleepAnalysis", []), tl, rank, day0, ndays, hr,
                          q.get("HeartRateVariabilitySDNN", []), q.get("OxygenSaturation", []),
                          cut_window=ref_params["sleep_duration"]["cut_window_min"] * 60)
    for k, vals in nights["daily"].items():
        daily[k] = rnd(vals, SLEEP_DECIMALS[k])
    sleep_era = source_runs(nights["src"], store.sources, days, min_run=3)
    for k in nights["daily"]:
        eras[k] = sleep_era

    say("训练与心电图…")
    workouts = build_workouts(store, tl, day0, ndays)
    ecgs = build_ecgs(src, tl, day0)

    # --- the export day is only half over: drop its running totals ---------------------
    partial = days[-1]
    for k in PARTIAL_KEYS:
        if k in daily:
            daily[k][-1] = None
    hr_hourly[-1] = None

    # --- analysis: personal baselines, sleep regularity, training load ------------------
    say("分析…")
    sleep_need = sleep_need_setting(cfg, ref_params["sleep_debt"]["need_hours"])
    analysis = build_analysis(days=days, daily=daily, sleep_kind=nights["kind"],
                              sleep_segments=nights["segments"], workouts=workouts,
                              params=ref_params, sleep_need=sleep_need)
    for w, (load, estimated) in zip(workouts, analysis.pop("workoutLoad")):
        w["load"], w["loadEst"] = load, estimated
    reports = build_reports(days=days, daily=daily, analysis=analysis["daily"], workouts=workouts,
                            params=ref_params, scores=reference["scores"], partial_day=partial, ecgs=ecgs,
                            names={ind["id"]: ind["name"] for ind in reference["indicators"]})
    annotations, annotation_warnings = read_annotations(ROOT / "标注.csv", day_index)
    backtest = sensitivity(days=days, daily=daily, analysis=analysis["daily"], workouts=workouts,
                           params=ref_params, scores=reference["scores"], sleep_need=sleep_need)
    backtest["annotations"] = annotation_check(annotations, analysis["daily"], ref_params)

    # --- checks -------------------------------------------------------------------------
    checks: dict = {}
    if check_pairs:
        rel = [abs(r - k) / k * 100 for _, k, r in check_pairs]
        checks["activeEnergy"] = {
            "days": len(rel),
            "medianDiffPct": round(statistics.median(rel), 2),
            "within2pct": round(100 * sum(x <= 2 for x in rel) / len(rel), 1),
            "within5pct": round(100 * sum(x <= 5 for x in rel) / len(rel), 1),
        }
    naive = sum(r[2] for r in q.get("StepCount", []))
    dedup = sum(r[2] for r in resolved["steps"])
    if naive:
        checks["steps"] = {"rawTotal": round(naive), "dedupTotal": round(dedup),
                           "removedPct": round(100 * (naive - dedup) / naive, 1)}

    # --- profile ------------------------------------------------------------------------
    me = store.me
    dob = me.get("HKCharacteristicTypeIdentifierDateOfBirth", "")
    age = None
    if len(dob) >= 10:
        exp_local = datetime.fromtimestamp(export_ts + exp_off, timezone.utc)
        age = exp_local.year - int(dob[:4]) - ((exp_local.month, exp_local.day) < (int(dob[5:7]), int(dob[8:10])))
    heights = sorted(q.get("Height", []))
    sex = {"HKBiologicalSexMale": "male", "HKBiologicalSexFemale": "female"}.get(
        me.get("HKCharacteristicTypeIdentifierBiologicalSex", ""))

    inventory = []
    for full, inv in sorted(store.inventory.items(), key=lambda kv: -kv[1]["n"]):
        inventory.append({
            "type": full.replace("HKQuantityTypeIdentifier", "").replace("HKCategoryTypeIdentifier", "")
                        .replace("HKDataType", ""),
            "n": inv["n"],
            "first": ts_date(inv["first"] + tl.offset(inv["first"])),
            "last": ts_date(inv["last"] + tl.offset(inv["last"])),
            "unit": inv["unit"],
            "sources": [store.sources[i] for i in sorted(inv["sources"], key=lambda i: rank[i])],
        })

    try:
        export_rel = str(src.path.relative_to(ROOT))
    except ValueError:
        export_rel = str(src.path)
    data = {
        "meta": {
            "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "exportDate": store.export_date[:16],
            "exportFile": export_rel,
            "firstDay": days[0], "lastDay": days[-1], "partialDay": partial,
            "records": n_records,
            "profile": {"sex": sex, "age": age, "heightCm": round(heights[-1][2], 1) if heights else None},
            "sources": [store.sources[i] for i in sorted(range(len(store.sources)), key=lambda i: rank[i])],
            "timezones": tz_desc,
            "eras": {k: v for k, v in eras.items() if v},
            "checks": checks,
            "inventory": inventory,
            "warnings": tzmod.warnings + [f"{t} 出现多种单位：{u}" for t, u in sorted(store.unknown_units, key=str)]
                        + annotation_warnings,
        },
        "days": days,
        "daily": daily,
        "sleepKind": nights["kind"],
        "sleepSegs": nights["segments"],
        "hrHourly": hr_hourly,
        "workouts": workouts,
        "ecg": ecgs,
        "analysis": analysis,
        "reports": reports,
        "backtest": backtest,
        "annotations": annotations,
        "reference": reference,
    }
    out_dir = ROOT / "dashboard"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / "data.js"
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    out.write_text("window.HEALTH_DATA=" + payload + ";\n", encoding="utf-8")
    # Minute-level heart rate and hourly steps for the single-day view. Kept in its own
    # file because it is the bulky part.
    intra = out_dir / "intraday.js"
    intra.write_text("window.HEALTH_INTRADAY=" + json.dumps(intraday, separators=(",", ":")) + ";\n",
                     encoding="utf-8")

    db_path = None
    if not args.no_db:
        say("写入 SQLite 数据库…")
        db_path = write_db(
            ROOT / "health.db", store=store, tl=tl, rank=rank, days=days, daily=daily,
            sleep_kind=nights["kind"], sleep_segments=nights["segments"], workouts=workouts, ecgs=ecgs,
            analysis=analysis["daily"], analysis_info=series_info(ref_params, sleep_need), annotations=annotations,
            reports=reports,
            tz_desc=tz_desc, cumulative={t for t, _ in SUMS.values()} | {"AppleStandTime"},
            meta={"export_date": store.export_date[:16], "generated_at": data["meta"]["generatedAt"],
                  "first_day": days[0], "last_day": days[-1], "partial_day": partial, "export_file": export_rel})

    say("")
    say(f"完成：{days[0]} → {days[-1]}（{ndays} 天），用时 {time.time() - t_start:.0f} 秒")
    if "activeEnergy" in checks:
        c = checks["activeEnergy"]
        say(f"  对账：去重后的活动能量与 Apple 每日汇总相比，中位偏差 {c['medianDiffPct']}%，"
            f"{c['within2pct']}% 的天数偏差在 2% 以内（共 {c['days']} 天）")
    if "steps" in checks:
        c = checks["steps"]
        say(f"  步数：直接相加 {c['rawTotal']:,} 步，去重后 {c['dedupTotal']:,} 步（去掉重复计数 {c['removedPct']}%）")
    say(f"  分析：{len(analysis['daily'])} 项逐日指标，睡眠需求按每晚 {sleep_need:g} 小时"
        + (f"；{len(annotations)} 天有标注" if annotations else ""))
    if reports:
        say(f"  周报：{len(reports)} 期。最近 7 天：{reports[-1]['headline']}")
    for w in data["meta"]["warnings"]:
        say(f"  ! {w}")
    say(f"  看板数据：{out}（{out.stat().st_size / 1024:.0f} KB）、{intra.name}（{intra.stat().st_size / 1024:.0f} KB）")
    if db_path is not None:
        say(f"  数据库：{db_path}（{db_path.stat().st_size / 1024 / 1024:.0f} MB）"
            + ("" if db_path.suffix == ".db" else "  ← health.db 正被其他程序占用，新文件先放在旁边"))
    index = out_dir / "index.html"
    if index.exists() and not args.no_open:
        webbrowser.open(index.as_uri())


if __name__ == "__main__":
    main()
