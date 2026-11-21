"""Write the processed data into one SQLite file for ad-hoc queries.

Tables
  daily              one row per local calendar day, every dashboard metric as a column
  analysis           one row per day: personal baselines, sleep regularity, training load
  reports            one row per weekly report: scores, states, suggestions
  metrics            data dictionary for the columns of ``daily`` and ``analysis`` (label, unit)
  samples            every raw sample of the supported types (compact; use the view below)
  types / sources    lookup tables for ``samples``
  sleep_segments     the sleep-stage segments the dashboard uses, one row per segment
  workouts           one row per workout
  annotations        the wearer's own day tags (from 标注.csv), one row per tag
  activity_summary   Apple's own per-day ring totals, as exported
  timezones          where the wearer was (zone per date range, and how it was determined)
  ecg                ECG recordings (metadata only)
  meta               export date, build time, ...
Views
  records            ``samples`` with names and local timestamps: the one to query
  weekly / monthly   averages of every ``daily`` column

For cumulative types (steps, energy, distance...) ``records.counted`` is the sample's value
after cross-device de-duplication: SUM(counted) is right, SUM(value) double-counts.
"""
from __future__ import annotations

import os
import re
import sqlite3
from pathlib import Path

from .daily import overlap_factors
from .parse import Store
from .tz import DAY, Timeline, date_ts, ts_date

# daily key -> (label, unit)
METRIC_INFO = {
    "steps": ("步数", "步"), "distance": ("步行 + 跑步距离", "公里"), "cycling": ("骑行距离", "公里"),
    "flights": ("爬楼", "层"), "activeKcal": ("活动能量", "千卡"), "basalKcal": ("静息能量", "千卡"),
    "totalKcal": ("总消耗", "千卡"), "moveGoal": ("活动圆环目标", "千卡"),
    "exerciseMin": ("锻炼时间", "分钟"), "exerciseGoal": ("锻炼圆环目标", "分钟"),
    "standHours": ("站立小时", "小时"), "standGoal": ("站立圆环目标", "小时"),
    "daylight": ("日照时间", "分钟"), "water": ("饮水", "毫升"),
    "rhr": ("静息心率", "bpm"), "hrv": ("心率变异性 SDNN（日均）", "ms"), "walkHr": ("步行平均心率", "bpm"),
    "hrMin": ("全天最低心率", "bpm"), "hrMax": ("全天最高心率", "bpm"),
    "hrAvg": ("全天平均心率（5 分钟分箱）", "bpm"), "vo2max": ("最大摄氧量", "ml/kg·min"),
    "wear": ("佩戴覆盖：全天有心率读数的 5 分钟时段占比", "%"),
    "sleepCut": ("睡眠记录可能被截断（醒来后一小时内没有心率读数，且明显短于平时）", "1 = 是，0 = 否"),
    "resp": ("睡眠呼吸频率", "次/分"), "spo2": ("血氧（日均）", "%"), "spo2Min": ("血氧（当日最低读数）", "%"),
    "wristTemp": ("睡眠手腕温度", "°C"), "breathDist": ("睡眠呼吸紊乱", "次/小时"),
    "sleepTotal": ("睡眠合计（含小睡）", "小时"), "sleepDeep": ("深睡", "小时"), "sleepCore": ("核心睡眠", "小时"),
    "sleepRem": ("快速眼动睡眠", "小时"), "sleepUnspec": ("未分期睡眠", "小时"),
    "sleepAwake": ("夜间清醒", "分钟"), "sleepInBed": ("睡眠时段长度 / 卧床", "小时"), "sleepNap": ("小睡", "小时"),
    "bedtime": ("入睡时间", "分钟，相对醒来日 00:00，负数为前一晚"),
    "waketime": ("醒来时间", "分钟，相对醒来日 00:00"),
    "sleepEff": ("睡眠效率", "%"), "wakeCount": ("夜间醒来次数", "次"),
    "sleepHr": ("睡眠平均心率", "bpm"), "sleepHrLow": ("睡眠最低心率（5 分钟均值）", "bpm"),
    "sleepHrv": ("睡眠期间 HRV", "ms"), "sleepSpo2": ("睡眠血氧", "%"),
    "deepPct": ("深睡占比", "%"), "corePct": ("核心睡眠占比", "%"), "remPct": ("快速眼动占比", "%"),
    "weight": ("体重", "kg"), "bodyFat": ("体脂率", "%"), "lean": ("去脂体重", "kg"),
    "fatMass": ("脂肪量", "kg"), "bmi": ("BMI", ""),
    "walkSpeed": ("步行速度", "公里/小时"), "stepLen": ("步长", "厘米"), "dblSupport": ("双脚支撑时间占比", "%"),
    "asym": ("步行不对称", "%"), "steadiness": ("步行稳定性", "%"), "sixMin": ("六分钟步行距离（估算）", "米"),
    "stairUp": ("上楼速度", "米/秒"), "stairDown": ("下楼速度", "米/秒"), "headphone": ("耳机音量", "分贝"),
}
STAGE_KEYS = ["deep", "core", "rem", "unspecified", "awake", "in_bed"]


def snake(key: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower()


def _clock(minutes: float | None) -> str | None:
    if minutes is None:
        return None
    m = int(round(minutes)) % 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def _local(day_index_date: str, minute: int) -> str:
    """date + minutes offset -> 'YYYY-MM-DD HH:MM' (minutes may be negative or > 1440)"""
    t = date_ts(day_index_date) + minute * 60
    return ts_date(t) + f" {t % DAY // 3600:02d}:{t % 3600 // 60:02d}"


def write_db(path: Path, *, store: Store, tl: Timeline, rank: dict[int, int], days: list[str],
             daily: dict[str, list], sleep_kind: list, sleep_segments: list, workouts: list[dict],
             ecgs: list[dict], tz_desc: list[dict], cumulative: set[str], meta: dict[str, str],
             analysis: dict[str, list] | None = None, analysis_info: dict[str, tuple[str, str]] | None = None,
             annotations: list[dict] | None = None, reports: list[dict] | None = None) -> Path:
    tmp = path.with_suffix(".db.tmp")
    if tmp.exists():
        tmp.unlink()
    con = sqlite3.connect(tmp)
    con.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;")
    cur = con.cursor()

    # ---- meta / timezones ----------------------------------------------------------------
    cur.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    cur.executemany("INSERT INTO meta VALUES (?, ?)", sorted(meta.items()))
    cur.execute("CREATE TABLE timezones (from_date TEXT, to_date TEXT, tz TEXT, basis TEXT)")
    cur.executemany("INSERT INTO timezones VALUES (?, ?, ?, ?)",
                    [(z["from"], z["to"], z["tz"], z["how"]) for z in tz_desc])

    # ---- daily + data dictionary -----------------------------------------------------------
    keys = sorted(daily)
    cols = [snake(k) for k in keys]
    cur.execute("CREATE TABLE metrics (column_name TEXT PRIMARY KEY, label TEXT, unit TEXT)")
    cur.executemany("INSERT INTO metrics VALUES (?, ?, ?)",
                    [(c, *METRIC_INFO.get(k, (k, ""))) for k, c in zip(keys, cols)]
                    + [("sleep_kind", "睡眠数据类型：stages 有分期 / asleep 无分期 / inbed 仅卧床记录", ""),
                       ("bedtime_clock", "入睡时间（当地时间 HH:MM）", ""),
                       ("waketime_clock", "醒来时间（当地时间 HH:MM）", ""),
                       ("weekday", "星期：1 = 周一 … 7 = 周日", "")])
    cur.execute("CREATE TABLE daily (date TEXT PRIMARY KEY, weekday INTEGER, sleep_kind TEXT, "
                "bedtime_clock TEXT, waketime_clock TEXT, " + ", ".join(f'"{c}" REAL' for c in cols) + ")")
    rows = []
    for i, d in enumerate(days):
        wd = (date_ts(d) // DAY + 3) % 7 + 1                  # 1970-01-01 was a Thursday
        rows.append((d, wd, sleep_kind[i], _clock(daily["bedtime"][i]), _clock(daily["waketime"][i]),
                     *[daily[k][i] for k in keys]))
    cur.executemany(f"INSERT INTO daily VALUES ({', '.join('?' * (5 + len(cols)))})", rows)
    avg_cols = ", ".join(f'ROUND(AVG("{c}"), 2) AS "{c}"' for c in cols)
    cur.execute(f"CREATE VIEW monthly AS SELECT substr(date, 1, 7) AS month, COUNT(*) AS days, {avg_cols} "
                "FROM daily GROUP BY 1")
    cur.execute("CREATE VIEW weekly AS SELECT date(date, '-' || (weekday - 1) || ' days') AS week_start, "
                f"COUNT(*) AS days, {avg_cols} FROM daily GROUP BY 1")

    # ---- analysis: each value uses only that day and the days before it -----------------------
    a_keys = list(analysis or {})
    a_cols = [snake(k) for k in a_keys]
    cur.executemany("INSERT INTO metrics VALUES (?, ?, ?)",
                    [(c, *(analysis_info or {}).get(k, (k, ""))) for k, c in zip(a_keys, a_cols)])
    cur.execute("CREATE TABLE analysis (date TEXT PRIMARY KEY" + "".join(f', "{c}" REAL' for c in a_cols) + ")")
    cur.executemany(f"INSERT INTO analysis VALUES ({', '.join('?' * (1 + len(a_cols)))})",
                    [(d, *[analysis[k][i] for k in a_keys]) for i, d in enumerate(days)] if a_keys else [])

    # ---- weekly reports: the seven days ending on end_date -----------------------------------
    cur.execute("CREATE TABLE reports (end_date TEXT PRIMARY KEY, start_date TEXT, headline TEXT, "
                "sleep_score INTEGER, activity_score INTEGER, recovery TEXT, steady_days INTEGER, "
                "judged_days INTEGER, training_load TEXT, load_ratio REAL, suggestions TEXT, long_term TEXT)")
    cur.executemany("INSERT INTO reports VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        (days[r["end"]], days[r["start"]], r["headline"], r["sleep"]["score"], r["activity"]["score"],
         r["recovery"]["label"], r["recovery"]["steady"], r["recovery"]["days"], r["load"]["label"],
         r["load"]["ratio"], "；".join(t["title"] for t in r["tips"]) or None,
         "；".join(x["name"] for x in r.get("long", []) if x["state"] == "note") or None)
        for r in reports or []])

    # ---- the wearer's own notes on particular days -------------------------------------------
    cur.execute("CREATE TABLE annotations (date TEXT, tag TEXT, note TEXT)")
    cur.executemany("INSERT INTO annotations VALUES (?, ?, ?)",
                    [(days[e["d"]], tag, e["note"] or None)
                     for e in annotations or [] for tag in (e["tags"] or [None])])

    # ---- raw samples -----------------------------------------------------------------------
    cur.execute("CREATE TABLE sources (id INTEGER PRIMARY KEY, name TEXT, priority INTEGER)")
    cur.executemany("INSERT INTO sources VALUES (?, ?, ?)",
                    [(i, name, rank.get(i, 99) + 1) for i, name in enumerate(store.sources)])
    cur.execute("CREATE TABLE types (id INTEGER PRIMARY KEY, name TEXT, unit TEXT, cumulative INTEGER)")
    cur.execute("CREATE TABLE samples (type_id INTEGER, source_id INTEGER, start_ts INTEGER, end_ts INTEGER, "
                "local_date TEXT, utc_offset_min INTEGER, value REAL, counted REAL)")
    date_cache: dict[int, str] = {}
    offset = tl.offset
    n_samples = 0
    for type_id, (name, recs) in enumerate(sorted(store.quantity.items()), start=1):
        is_cum = name in cumulative
        cur.execute("INSERT INTO types VALUES (?, ?, ?, ?)", (type_id, name, store.units.get(name), int(is_cum)))
        factors = overlap_factors(recs, rank) if is_cum else None
        batch = []
        for i, (s, e, v, src) in enumerate(recs):
            off = offset(s)
            day = (s + off) // DAY
            date = date_cache.get(day)
            if date is None:
                date = date_cache[day] = ts_date(day * DAY)
            batch.append((type_id, src, s, e, date, off // 60, v, v * factors[i] if factors else v))
        cur.executemany("INSERT INTO samples VALUES (?, ?, ?, ?, ?, ?, ?, ?)", batch)
        n_samples += len(batch)
    cur.execute("CREATE INDEX idx_samples_type_date ON samples (type_id, local_date)")
    cur.execute("""
        CREATE VIEW records AS
        SELECT t.name AS type, s.name AS source, x.local_date,
               time(x.start_ts + x.utc_offset_min * 60, 'unixepoch') AS local_time,
               datetime(x.start_ts + x.utc_offset_min * 60, 'unixepoch') AS local_start,
               datetime(x.end_ts + x.utc_offset_min * 60, 'unixepoch') AS local_end,
               datetime(x.start_ts, 'unixepoch') AS utc_start,
               x.end_ts - x.start_ts AS seconds,
               x.value, x.counted, t.unit
        FROM samples x JOIN types t ON t.id = x.type_id JOIN sources s ON s.id = x.source_id""")

    # ---- sleep segments (the source chosen for each night) -----------------------------------
    cur.execute("CREATE TABLE sleep_segments (night TEXT, stage TEXT, local_start TEXT, local_end TEXT, minutes INTEGER)")
    seg_rows = []
    for d, segs in sleep_segments:
        for a, b, code in segs:
            seg_rows.append((days[d], STAGE_KEYS[code], _local(days[d], a), _local(days[d], b), b - a))
    cur.executemany("INSERT INTO sleep_segments VALUES (?, ?, ?, ?, ?)", seg_rows)
    cur.execute("CREATE INDEX idx_sleep_night ON sleep_segments (night)")

    # ---- workouts ----------------------------------------------------------------------------
    cur.execute("CREATE TABLE workouts (date TEXT, start_time TEXT, type TEXT, type_key TEXT, minutes REAL, "
                "active_kcal REAL, distance_km REAL, hr_avg REAL, hr_max REAL, hr_min REAL, mets REAL, effort REAL, "
                "indoor INTEGER, temp_c REAL, elevation_m REAL, zone1_min REAL, zone2_min REAL, zone3_min REAL, "
                "zone4_min REAL, zone5_min REAL, source TEXT, timezone TEXT, load REAL, load_estimated INTEGER)")
    for w in workouts:
        z = (w["zones"] + [None] * 5)[:5] if len(w["zones"]) == 5 else [None] * 5
        estimated = w.get("loadEst")
        cur.execute("INSERT INTO workouts VALUES (" + ", ".join("?" * 24) + ")",
                    (days[w["d"]], w["time"], w["type"], w["key"], w["min"], w["kcal"], w["dist"], w["hrAvg"],
                     w["hrMax"], w["hrMin"], w["mets"], w["effort"], int(w["indoor"]), w["tempC"], w["elev"],
                     *z, w["src"], w["tz"], w.get("load"), None if estimated is None else int(estimated)))

    # ---- Apple's own daily summary -----------------------------------------------------------
    cur.execute("CREATE TABLE activity_summary (date TEXT PRIMARY KEY, active_kcal REAL, move_goal REAL, "
                "exercise_min REAL, exercise_goal REAL, stand_hours REAL, stand_goal REAL)")

    def num(a: dict, k: str) -> float | None:
        try:
            return float(a[k])
        except (KeyError, ValueError):
            return None

    cur.executemany("INSERT OR REPLACE INTO activity_summary VALUES (?, ?, ?, ?, ?, ?, ?)", [
        (a.get("dateComponents"), num(a, "activeEnergyBurned"), num(a, "activeEnergyBurnedGoal"),
         num(a, "appleExerciseTime"), num(a, "appleExerciseTimeGoal"), num(a, "appleStandHours"),
         num(a, "appleStandHoursGoal")) for a in store.activity if a.get("dateComponents")])

    # ---- ECG metadata ------------------------------------------------------------------------
    cur.execute("CREATE TABLE ecg (date TEXT, time TEXT, classification TEXT, heart_rate_est INTEGER, "
                "seconds REAL, sample_rate_hz REAL, lead TEXT)")
    cur.executemany("INSERT INTO ecg VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [(e["date"], e["time"], e["cls"], e["hr"], e["sec"], e["fs"], e["lead"]) for e in ecgs])

    cur.execute("INSERT INTO meta VALUES ('samples', ?)", (str(n_samples),))
    con.commit()
    con.close()
    try:
        os.replace(tmp, path)
    except PermissionError:
        # the old file is open in another program: leave the new one beside it
        return tmp
    return path
