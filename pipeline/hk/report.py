"""Weekly reports: the seven days ending on a given day, scored and put into words.

One report is built for every Sunday in the data and one for the latest day, so there is
always a current one. A report reads the analysis series "as of" its last day, and those
only ever look backwards, so an old report never changes.

Every threshold comes from reference.json. The wording follows three rules:
say what was recorded, not what must be true ("the watch recorded 3 hours");
suggest one small thing to try instead of giving an order; no alarm words.

Each suggestion also carries a ``quip``: the same advice as a stock-market joke
("三倍做多力量训练", "重点关注睡眠 ETF"), because a line that makes you smile is one you
remember. The plain ``title`` and the facts in ``text`` stay next to it. Signals that
might mean illness keep a gentle quip that never makes light of them.
"""
from __future__ import annotations

from datetime import date

from .analysis import _sd, hr_episodes
from .audio import energy_mean
from .screening import screen

WEEKDAYS = "一二三四五六日"
SIGNAL_WORDS = {
    "sleepHr": "睡眠心率偏高", "sleepHrv": "HRV 偏低", "resp": "呼吸偏快",
    "wristTemp": "手腕温度偏高", "sleepSpo2": "血氧偏低",
}
RECOVERY_WORDS = {"steady": "平稳", "mixed": "有些波动", "low": "偏弱", "none": "数据不足"}
LOAD_WORDS = {
    "far_below": "明显少于平时", "below": "少于平时", "steady": "和平时相当", "above": "多于平时",
    "far_above": "明显多于平时", "restart": "刚恢复训练", "rest": "这周没有训练", "new": "还在积累历史",
    "none": "没有训练记录",
}


# ---------------------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------------------

def interpolate(points: list[list[float]], x: float) -> float:
    """Piecewise-linear curve through ``points`` ([[x, y], ...], x ascending), flat outside."""
    if x <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return points[-1][1]


def score(spec: dict, values: dict[str, float | None]) -> dict:
    """A 0-100 score from its parts. Parts without data are left out and the rest rescaled;
    there is no score when the parts that do have data carry fewer than 40 of the 100 points."""
    parts = []
    got = have = 0.0
    for part in spec["parts"]:
        v = values.get(part["key"])
        if v is None:
            parts.append({"key": part["key"], "points": None, "max": part["max"]})
            continue
        pts = part["max"] * interpolate(part["curve"], v)
        parts.append({"key": part["key"], "points": round(pts), "max": part["max"]})
        got += pts
        have += part["max"]
    total = sum(p["max"] for p in spec["parts"])
    if have < 0.4 * total:
        return {"score": None, "parts": parts, "partial": False}
    return {"score": round(100 * got / have), "parts": parts, "partial": have < total}


def hours_text(h: float) -> str:
    m = int(round(h * 60))
    return f"{m // 60} 小时 {m % 60:02d} 分" if m % 60 else f"{m // 60} 小时"


def day_text(day: str) -> str:
    """'2025-03-08' -> '3 月 8 日（周六）'"""
    d = date.fromisoformat(day)
    return f"{d.month} 月 {d.day} 日（周{WEEKDAYS[d.weekday()]}）"


def report_days(days: list[str]) -> list[int]:
    """Indices a report is built for: each Sunday with a full week behind it, and the last day."""
    out = [i for i, d in enumerate(days) if i >= 6 and date.fromisoformat(d).weekday() == 6]
    if days and (not out or out[-1] != len(days) - 1) and len(days) >= 7:
        out.append(len(days) - 1)
    return out


# ---------------------------------------------------------------------------------------
# the four sections
# ---------------------------------------------------------------------------------------

def _get(A: dict[str, list], key: str, i: int):
    series = A.get(key)
    return None if series is None else series[i]


def _hr_runs(i: int, A: dict[str, list], p: dict) -> list[dict]:
    """Runs of nights with sleeping heart rate well above usual that end inside the seven
    days (or are still going on), as known on day i."""
    run = A.get("hrRun")
    if not run:
        return []
    found = hr_episodes(run, A["hrRise"], A["hrBase"], min_nights=p["min_nights"], max_gap_nights=p["max_gap_nights"],
                        upto=i)
    return [e for e in found if e["end"] >= i - 6]


def _recovery(i: int, A: dict[str, list], P: dict) -> dict:
    band, high, need = P["hrv_night"]["band_sd"], P["rhr"]["high_sd"], P["night_vitals"]["min_outliers"]
    signals = P["night_vitals"]["signals"]
    steady = evaluated = high_days = 0
    nights = []
    runs = _hr_runs(i, A, P["night_hr_rise"])
    in_run = {m for e in runs for m in e["members"]}
    for j in range(i - 6, i + 1):
        z, rz, out = A["hrvZ"][j], A["rhrZ"][j], A["vitalsOut"][j]
        if z is None and rz is None and out is None and _get(A, "hrRun", j) is None:
            continue
        evaluated += 1
        low = z is not None and z < -band
        up = rz is not None and rz >= high
        flagged = out is not None and out >= need
        high_days += up
        steady += not (low or up or flagged or j in in_run)
        if flagged:
            off = []
            for key, spec in signals.items():
                v = A["z" + key[0].upper() + key[1:]][j]
                if v is not None and (v if spec["worse"] == "high" else -v) >= P["night_vitals"]["outlier_sd"]:
                    off.append([key, v])
            nights.append({"d": j, "signals": off})
    run = 0                                           # days in a row, up to today, below the band
    for j in range(i, -1, -1):
        z = A["hrvZ"][j]
        if z is None or z >= -band:
            break
        run += 1
    rz = A["rhrZ"][i]
    if evaluated < 4:
        state = "none"
    elif (run >= P["hrv_night"]["low_run_days"] or (rz is not None and rz >= high) or len(nights) >= 2
          or any(e["ongoing"] for e in runs)):
        state = "low"
    elif steady < evaluated:
        state = "mixed"
    else:
        state = "steady"
    return {
        "state": state, "label": RECOVERY_WORDS[state],
        "steady": steady, "days": evaluated, "lowRun": run, "highDays": high_days, "nights": nights, "hrRuns": runs,
        "hrv7": A["hrv7"][i], "hrvBase": A["hrvBase"][i], "hrvLo": A["hrvLo"][i], "hrvHi": A["hrvHi"][i],
        "rhr7": A["rhr7"][i], "rhrBase": A["rhrBase"][i], "rhrHi": A["rhrHi"][i], "rhrZ": rz,
    }


def _sleep(i: int, daily: dict[str, list], A: dict[str, list], S: dict) -> dict:
    cut = daily.get("sleepCut") or []
    win = range(i - 6, i + 1)
    counted = [j for j in win if daily["sleepTotal"][j] is not None and not (cut and cut[j])]
    beds = [daily["bedtime"][j] for j in counted if daily["bedtime"][j] is not None]
    wakes = [daily["waketime"][j] for j in counted if daily["waketime"][j] is not None]
    sri = A["sri7"][i] if A["sri7"][i] is not None else A["sri28"][i]
    out = score(S["sleep"], {"duration": A["sleep7"][i], "regularity": sri})
    out.update({
        "nights": len(counted), "cut": sum(1 for j in win if cut and cut[j]),
        "mean": A["sleep7"][i], "short": A["shortNights7"][i],
        "bed": round(sum(beds) / len(beds)) if beds else None,
        "wake": round(sum(wakes) / len(wakes)) if wakes else None,
        "sri": A["sri7"][i], "sri28": A["sri28"][i], "bedSd": A["bedSd7"][i], "durSd": A["durSd7"][i],
        "debt": A["sleepDebt14"][i],
    })
    return out


def _activity(i: int, A: dict[str, list], S: dict, P: dict) -> dict:
    """Steps, active minutes and strength days. Active minutes come from the watch's METs
    (moderate + 2 x vigorous) where it records them, else from Apple's exercise minutes."""
    mvpa, apple = _get(A, "mvpa7", i), A["exercise7"][i]
    minutes = mvpa if mvpa is not None else apple
    out = score(S["activity"], {"steps": A["steps7"][i], "exercise": minutes, "strength": A["strengthDays7"][i]})
    top = _get(A, "topShare7", i)
    out.update({
        "steps": A["steps7"][i], "exercise": minutes, "strength": A["strengthDays7"][i],
        "source": "effort" if mvpa is not None else "exercise" if apple is not None else None,
        "appleExercise": apple, "moderate": _get(A, "mod7", i), "vigorous": _get(A, "vig7", i),
        "bursts": _get(A, "bursts7", i), "topShare": top,
        # "weekend warrior": the week's target met, more than half of it on its two busiest days
        "concentrated": (mvpa is not None and mvpa >= P["activity_minutes"]["moderate_min"][0] and top is not None
                         and top >= P["activity_pattern"]["top_share"]),
    })
    return out


def _load(i: int, A: dict[str, list], workouts_by_day: dict[int, list], P: dict) -> dict:
    p = P["training_load"]
    load7, base, ratio = A["load7"][i], A["loadBase"][i], A["loadRatio"][i]
    week = [w for j in range(i - 6, i + 1) for w in workouts_by_day.get(j, [])]
    if load7 is None:
        state = "none"
    elif ratio is not None:
        lo, hi = p["steady_ratio"]
        state = ("far_below" if ratio < p["low_ratio"] else "below" if ratio < lo else "steady" if ratio <= hi
                 else "above" if ratio <= p["high_ratio"] else "far_above")
    elif load7 == 0:
        state = "rest"
    elif base is not None:
        state = "restart"                              # training again after weeks with almost none
    else:
        state = "new"                                  # too little history to compare with
    return {
        "state": state, "label": LOAD_WORDS[state], "ratio": ratio, "load7": load7, "base": base,
        "sessions": len(week), "minutes": round(sum(w["min"] for w in week)), "since": A["daysSinceWorkout"][i],
    }


def _hearing(i: int, daily: dict[str, list]) -> dict:
    """Headphone listening in the seven days: time, average level and sound dose (summed day by day)."""
    lm, db, dose = daily.get("listenMin"), daily.get("headphone"), daily.get("hpDose")
    win = range(i - 6, i + 1)
    if not lm or all(lm[j] is None for j in win):
        return {"minutes": None, "db": None, "dose": None}
    minutes = sum(lm[j] or 0 for j in win)
    pairs = [(lm[j], db[j]) for j in win if lm[j] and db and db[j] is not None]
    level = energy_mean(pairs)
    doses = [dose[j] for j in win if dose and dose[j] is not None]
    return {"minutes": round(minutes), "db": None if level is None else round(level, 1),
            "dose": round(sum(doses), 2) if doses else None}


# ---------------------------------------------------------------------------------------
# suggestions
# ---------------------------------------------------------------------------------------

def _tips(days: list[str], rec: dict, slp: dict, act: dict, load: dict, P: dict,
          hear: dict | None = None) -> list[dict]:
    """Suggestions for the week, most important first. Level 3: body signals worth noticing;
    2: a habit worth adjusting; 1: a small note."""
    tips: list[dict] = []

    def add(tid: str, level: int, focus: str, title: str, text: str, basis: list[str], quip: str) -> None:
        tips.append({"id": tid, "level": level, "focus": focus, "title": title, "quip": quip, "text": text, "basis": basis})

    if rec["nights"]:
        n = len(rec["nights"])
        when = "、".join(day_text(days[x["d"]]) for x in rec["nights"])
        seen: list[str] = []
        for x in rec["nights"]:
            for key, _z in x["signals"]:
                if SIGNAL_WORDS[key] not in seen:
                    seen.append(SIGNAL_WORDS[key])
        add("vitals", 3 if n >= 2 else 2, "那几晚的身体信号" if n >= 2 else "那一晚的身体信号",
            f"有 {n} 晚的身体信号和平时不一样",
            f"{when}，{'、'.join(seen)}，同时偏离了你平时的范围。生病、饮酒、熬夜、表带松了都可能造成这种变化。"
            "如果那几天确实不舒服，这几天练得轻一些、多休息；知道原因的话，可以记进标注里。",
            ["night_vitals"], quip=f"身体盘面异动 {n} 晚，先别加仓")
    if rec.get("hrRuns"):
        hp = P["night_hr_rise"]
        ep = max(rec["hrRuns"], key=lambda e: (e["ongoing"], e["nights"], e["end"]))
        n, rise = ep["nights"], hp["rise_bpm"]
        vitals_too = len({x["d"] for x in rec["nights"]} & set(ep["members"]))
        also = f"其中 {vitals_too} 晚也有多项夜间体征同时偏离。" if vitals_too else ""
        why = ("压力、饮酒、练得太猛、作息被打乱都会这样，生病时也会。一项 3,318 人的研究里，"
               "生病引起的连续偏高平均持续 6 天左右，其他原因大约 3 天半。")
        if ep["ongoing"]:
            add("hr_run", 3 if n >= hp["long_nights"] else 2, "睡眠心率", f"睡眠心率连续 {n} 晚比平时高",
                f"从{day_text(days[ep['start']])}起，睡眠心率已经连续 {n} 晚比你平时（此前各晚的中位数约 {ep['base']:.0f} 次/分）"
                f"高出 {rise:g} 次/分以上，最多高 {ep['rise']:.0f}。{also}{why}"
                "这几天先练得轻一些、早点睡，留意身体有没有不舒服；想到原因的话，记进标注里。",
                ["night_hr_rise"],
                quip=f"心率夜盘连续高开 {n} 晚，空仓观望几天" if n >= hp["long_nights"] else f"心率夜盘连续高开 {n} 晚，先别加仓")
        else:
            add("hr_run", 3 if n >= hp["long_nights"] else 1, "睡眠心率", f"有 {n} 晚睡眠心率比平时高，已经回落",
                f"{day_text(days[ep['start']])}到{day_text(days[ep['end']])}，睡眠心率连续 {n} 晚比你平时（约 {ep['base']:.0f} 次/分）"
                f"高出 {rise:g} 次/分以上，最多高 {ep['rise']:.0f}，之后回到了平时的水平。{also}{why}"
                "想到原因的话，可以记进标注里，以后对照着看。",
                ["night_hr_rise"], quip="心率夜盘高开后已回落，记一笔复盘")
    if rec["lowRun"] >= P["hrv_night"]["low_run_days"] and rec["hrv7"] is not None:
        add("hrv_low", 2, "恢复", "这几天适合把强度降一档",
            f"夜间 HRV 的 7 日均值已经连续 {rec['lowRun']} 天低于你的平稳带"
            f"（现在 {rec['hrv7']:g} ms，平稳带 {rec['hrvLo']:g}–{rec['hrvHi']:g} ms）。"
            "这通常说明身体还在消化最近的负担，训练、睡得少、压力、生病都有可能。"
            "接下来几天轻仓操作：练得轻一点，优先睡够；等它重新站上平稳带，再把强度加回来。",
            ["hrv_night"], quip=f"恢复指数连跌 {rec['lowRun']} 天，建议减仓观望")
    if rec["rhrZ"] is not None and rec["rhrZ"] >= P["rhr"]["high_sd"]:
        add("rhr_high", 2, "静息心率", "静息心率比平时高了一些",
            f"静息心率的 7 日均值是 {rec['rhr7']:g} 次/分，比你的基线 {rec['rhrBase']:g} 高出 "
            f"{rec['rhr7'] - rec['rhrBase']:.1f}，超出了平时的波动范围。"
            "常见的原因是睡得少、饮酒、压力大，或者身体在应对感染。这几天先别追高（少安排高强度），多休息、多喝水，看它是否回落。",
            ["rhr"], quip="静息心率高位站岗，先空仓休息")

    d = P["sleep_duration"]
    mean, short = slp["mean"], slp["short"] or 0
    if mean is not None:
        cut_note = f"另有 {slp['cut']} 晚的记录可能不完整，没有算进来。" if slp["cut"] else ""
        if mean < d["short_week_mean_hours"] or short >= d["short_nights_in_week"]:
            few = f"，其中 {short} 晚不足 {d['short_night_hours']:g} 小时" if short else ""
            add("sleep_short", 2, "睡眠时长", "这周睡得偏少，找机会补一补",
                f"手表记录到这 7 天平均每晚睡 {hours_text(mean)}{few}。"
                f"接下来几天每晚早睡半小时到一小时，慢慢把这笔亏损补回来。{cut_note}",
                ["sleep_duration", "sleep_debt"],
                quip="睡眠板块小型股灾，逢低补仓" if short >= d["short_nights_in_week"] else "睡眠账户出现亏损，逢低补仓")
        elif mean < d["min_hours"]:
            add("sleep_below", 1, "睡眠时长", "睡眠时长略低于建议",
                f"这 7 天平均每晚睡 {hours_text(mean)}，略低于成年人每晚 {d['min_hours']:g} 小时的建议下限。"
                f"每晚多配置一点睡眠，长线持有。{cut_note}",
                ["sleep_duration"], quip="重点关注睡眠 ETF")

    # Several times the earlier load means the earlier weeks were nearly empty: that is coming
    # back from a break, not "adding too fast", and the ratio itself says little.
    back = load["state"] == "restart" or (load["ratio"] is not None and load["ratio"] > P["training_load"]["restart_ratio"])
    if back:
        add("load_restart", 1, "恢复训练的节奏", "刚恢复训练，慢慢来",
            "此前四周练得很少，这周重新练起来了。头两周先用平时七成左右的仓位，再逐步加回去。",
            ["training_load"], quip="重新建仓，先轻仓试水")
    elif load["state"] == "far_above":
        add("load_up", 2, "训练加量的速度", "这周加量有点快",
            f"这 7 天的训练负荷是此前四周周均的 {load['ratio']:g} 倍。身体适应需要时间，下一周先保持这个仓位，别再加杠杆。",
            ["training_load"], quip="训练杠杆加太猛，当心爆仓")

    reg, var = P["sleep_regularity"], P["sleep_timing_variability"]
    irregular = slp["sri28"] is not None and slp["sri28"] < reg["low"]
    scattered = slp["bedSd"] is not None and slp["bedSd"] > var["onset_sd_high"]
    if irregular or scattered:
        facts = []
        if slp["bedSd"] is not None:
            facts.append(f"这 7 天入睡时间的波动（标准差）是 {slp['bedSd']} 分钟")
        if slp["sri28"] is not None:
            facts.append(f"近四周的作息规律指数是 {slp['sri28']:g}，参照人群的中位数约 {reg['median']:g}")
        add("sleep_irregular", 2, "作息规律", "试着把作息固定下来",
            "，".join(facts) + "。可以先固定起床时间，周末也尽量不比平时晚一小时以上，入睡时间通常会慢慢跟着稳下来。",
            ["sleep_regularity", "sleep_timing_variability"], quip="作息 K 线上蹿下跳，先锁定起床时间")

    s, a = P["steps"], P["activity_minutes"]
    if act["steps"] is not None and act["steps"] < s["low"]:
        add("steps_low", 2, "日常步数", "每天多走一走",
            f"这 7 天日均 {act['steps']:,} 步，低于 {s['low']:,} 步。每天定投一次 15 到 20 分钟的步行，大约能多出 2,000 步。",
            ["steps"], quip="步数跌破均线，每天定投 2,000 步")
    if act["exercise"] is not None and act["exercise"] < a["moderate_min"][0]:
        if act.get("source") == "effort":
            facts = (f"这 7 天中等强度约 {act['moderate']} 分钟、高强度约 {act['vigorous']} 分钟，"
                     f"高强度 1 分钟按 {a['vigorous_weight']:g} 分钟算，合计约 {act['exercise']} 分钟，"
                     f"建议每周至少 {a['moderate_min'][0]} 分钟。")
        else:
            facts = f"这 7 天达到快走以上强度的活动合计约 {act['exercise']} 分钟，建议每周至少 {a['moderate_min'][0]} 分钟。"
        add("activity_low", 2, "活动量", "这周活动量偏少",
            facts + "不用一次满仓，每天加仓 10 到 15 分钟就能够到。抽不出整段时间的话，生活里的短时高强度也算："
            "快步爬几层楼、小跑赶一趟车，每次 1 到 2 分钟，一天 3 次。一项 2.5 万名平时不锻炼的人参与的研究里，"
            "这样的习惯和明显更低的心血管风险相关。",
            ["activity_minutes", "activity_pattern"], quip="运动成交量萎缩，每天小额加仓")

    hp = P.get("headphone_dose")
    if hp and hear and hear["dose"] is not None and hear["dose"] >= hp["tip_percent"]:
        level = f"，平均音量 {hear['db']:g} 分贝" if hear["db"] is not None else ""
        add("headphone_loud", 2, "耳机音量", "这周耳机音量偏大",
            f"这 7 天的耳机声音剂量是 WHO 每周参考量的 {hear['dose']:.0f}%（100% 相当于 {hp['ref_db']:g} 分贝听 "
            f"{hp['ref_hours']:g} 小时）{level}，一共听了 {hours_text(hear['minutes'] / 60)}。"
            "可以逢高减仓，把音量调低一两格：每低 3 分贝，同样的剂量能听的时间就多一倍。在地铁这类吵的地方，开降噪比调大音量更护耳。",
            ["headphone_dose"], quip="耳机音量高位运行，逢高减仓")

    gap = P["training_gap"]["gap_days"]
    if load["since"] is not None and load["since"] >= gap:
        add("training_gap", 1, "训练的连续性", "有一阵没训练了",
            f"距离上次训练记录已经 {load['since']} 天。忙或者在休息都很正常；想复牌的话，从比平时轻松的一次开始。",
            ["training_gap"], quip=f"被沙发套牢 {load['since']} 天，择机复牌")
    elif (act["strength"] is not None and act["strength"] < P["strength_days"]["min_days_per_week"]
          and load["since"] is not None):
        add("strength_low", 1, "力量训练", "可以加一次力量训练",
            f"这 7 天有 {act['strength']} 天做了力量训练，建议每周至少 {P['strength_days']['min_days_per_week']} 天，练到主要肌群，长线持有。",
            ["strength_days"], quip="三倍做多力量训练")

    tips.sort(key=lambda t: -t["level"])              # stable: ties keep the order above
    return tips


def _headline(rec: dict, slp: dict, act: dict, load: dict, tips: list[dict], long: list[dict]) -> str:
    week = _week_line(rec, slp, act, load, tips)
    slow = sum(1 for x in long if x["state"] == "note")
    return week + (f"另有 {slow} 项长期变化值得留意。" if slow else "")


def _week_line(rec: dict, slp: dict, act: dict, load: dict, tips: list[dict]) -> str:
    if rec["state"] == "none" and slp["score"] is None and act["score"] is None:
        return "这 7 天的数据还不够，多戴几天再来看。"
    # Praise an area only when it has no suggestion of its own: "sleep was good" next to
    # "sleep a little longer" would contradict itself.
    ids = {t["id"] for t in tips}
    good = []
    if rec["state"] == "steady" and not ids & {"vitals", "hr_run", "hrv_low", "rhr_high"}:
        good.append("恢复平稳")
    if slp["score"] is not None and slp["score"] >= 80 and not ids & {"sleep_short", "sleep_below", "sleep_irregular"}:
        good.append("睡眠不错")
    if act["score"] is not None and act["score"] >= 80 and not ids & {"steps_low", "activity_low", "strength_low"}:
        good.append("活动量充足")
    if load["state"] == "steady" and not ids & {"load_up", "load_restart", "training_gap"}:
        good.append("训练节奏平稳")
    lead = "、".join(good)
    known = sum([rec["state"] != "none", slp["score"] is not None, act["score"] is not None,
                 load["state"] not in ("none", "new")])
    if not tips:
        if known < 2:                                  # e.g. a phone alone: steps and nothing else
            return "这 7 天的记录不多，只能看到一部分情况。"
        return (lead + "。" if lead else "") + "各项都在合适的范围内，保持就好。"
    if tips[0]["level"] >= 2:
        return (lead + "；" if lead else "") + f"这周最值得留意的是{tips[0]['focus']}。"
    return (lead + "。" if lead else "") + f"可以顺手看看{tips[0]['focus']}。"


# ---------------------------------------------------------------------------------------
# everything together
# ---------------------------------------------------------------------------------------

def build_reports(*, days: list[str], daily: dict[str, list], analysis: dict[str, list], workouts: list[dict],
                  params: dict[str, dict], scores: dict, partial_day: str | None = None,
                  ecgs: list[dict] | None = None, names: dict[str, str] | None = None) -> list[dict]:
    """Reports in date order. Weeks with nothing to say (no data in any section) are left out.

    ``names`` maps indicator ids to their display names, for the long-window checks.
    """
    by_day: dict[int, list] = {}
    for w in workouts:
        by_day.setdefault(w["d"], []).append(w)
    out = []
    for i in report_days(days):
        rec = _recovery(i, analysis, params)
        slp = _sleep(i, daily, analysis, scores)
        act = _activity(i, analysis, scores, params)
        load = _load(i, analysis, by_day, params)
        if rec["state"] == "none" and slp["score"] is None and act["score"] is None and load["state"] in ("none", "rest"):
            continue
        hear = _hearing(i, daily)
        tips = _tips(days, rec, slp, act, load, params, hear)
        long = screen(i, daily=daily, analysis=analysis, ecgs=ecgs or [], params=params)
        for x in long:
            x["name"] = (names or {}).get(x["id"], x["id"])
        out.append({
            "end": i, "start": i - 6,
            "sunday": date.fromisoformat(days[i]).weekday() == 6,
            "partial": days[i] == partial_day,
            "headline": _headline(rec, slp, act, load, tips, long),
            "tips": tips, "recovery": rec, "sleep": slp, "activity": act, "load": load, "long": long,
            "hearing": hear,
        })
    _score_bands(out, params)
    return out


def _score_bands(reports: list[dict], P: dict) -> None:
    """How far a score has to move from one report to the next before it is more than the
    usual week-to-week wobble: 1.96 SD of the changes between consecutive earlier Sundays.

    Only earlier Sundays count, so a report's band never changes once the week is over.
    """
    nb = P.get("noise_band")
    if not nb:
        return
    sundays = [r for r in reports if r["sunday"]]
    for r in reports:
        earlier = [s for s in sundays if s["end"] < r["end"]][-(nb["score_weeks"] + 1):]
        for key in ("sleep", "activity"):
            diffs = [b[key]["score"] - a[key]["score"] for a, b in zip(earlier, earlier[1:])
                     if b["end"] - a["end"] == 7 and a[key]["score"] is not None and b[key]["score"] is not None]
            r[key]["band"] = round(nb["z"] * _sd(diffs), 1) if len(diffs) >= nb["min_score_weeks"] else None
