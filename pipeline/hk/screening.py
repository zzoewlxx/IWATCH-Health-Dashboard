"""Slow changes: patterns over one to six months that may be worth mentioning to a doctor.

Nothing here reacts to a single night or a single week; every check needs the change to
have lasted. Like the rest of the analysis, each is computed "as of" a day from that day
and the days before it.

The wording never says what the wearer has. It says what changed in the record, what
commonly causes such a change, and, when it has persisted without an obvious reason, which
kind of clinic to bring the record to. Thresholds and their sources are in reference.json.
"""
from __future__ import annotations

from .analysis import _mean, _vals

WORDS = {"note": "值得留意", "ok": "没有发现持续变化", "none": "数据不足"}


def _item(cid: str, state: str, fact: str, text: str = "") -> dict:
    return {"id": cid, "state": state, "fact": fact, "text": text}


def _rhr(i: int, daily: dict, p: dict) -> dict:
    series = daily.get("rhr") or []
    recent = _vals(series, i - p["recent_days"] + 1, i)
    prior = _vals(series, i - p["recent_days"] - p["prior_days"] + 1, i - p["recent_days"])
    if len(recent) < p["min_recent"]:
        return _item("rhr_long", "none", f"近 {p['recent_days']} 天有静息心率的日子不足 {p['min_recent']} 天")
    r = _mean(recent)
    if r >= p["high_bpm"]:
        return _item("rhr_long", "note", f"近 {p['recent_days']} 天平均 {r:.0f} 次/分",
                     f"近 {p['recent_days']} 天的静息心率平均 {r:.0f} 次/分，高于成年人常见的 60 到 100。"
                     "咖啡因、压力、发烧、某些药物都可能造成。如果一直这样又想不到原因，"
                     "建议带着这份记录咨询医生（心内科或全科）。")
    if len(prior) < p["min_prior"]:
        return _item("rhr_long", "ok", f"近 {p['recent_days']} 天平均 {r:.0f} 次/分；更早的数据还不够比较")
    q = _mean(prior)
    if r - q >= p["rise_bpm"]:
        return _item("rhr_long", "note", f"近 {p['recent_days']} 天平均 {r:.0f} 次/分，此前三个月 {q:.0f}",
                     f"近 {p['recent_days']} 天的静息心率平均 {r:.0f} 次/分，比此前三个月的 {q:.0f} 高了 {r - q:.0f}。"
                     "训练量变化、生病、压力、天气变热、换了设备都可能造成。想不到原因的话，下次看医生时可以提一下。")
    return _item("rhr_long", "ok", f"近 {p['recent_days']} 天平均 {r:.0f} 次/分，此前三个月 {q:.0f}，变化不大")


def _spo2(i: int, daily: dict, p: dict) -> dict:
    nights = _vals(daily.get("sleepSpo2") or [], i - p["recent_days"] + 1, i)
    if len(nights) < p["min_nights"]:
        return _item("spo2_long", "none", f"近 {p['recent_days']} 天有睡眠血氧的夜晚不足 {p['min_nights']} 晚")
    m = _mean(nights)
    low = sum(1 for v in nights if v < p["low_percent"])
    if low >= p["low_nights"] or m < p["mean_low"]:
        return _item("spo2_long", "note", f"近 {p['recent_days']} 天平均 {m:.1f}%，{low} 晚低于 {p['low_percent']}%",
                     f"近 {p['recent_days']} 天的睡眠血氧平均 {m:.1f}%，其中 {low} 晚整晚平均低于 {p['low_percent']}%。"
                     "手表的血氧容易受佩戴影响，先确认表带贴合。如果一直这样，建议咨询医生（呼吸科或睡眠门诊），"
                     "可以问问是否需要用医用血氧仪核对，或者做一次睡眠监测。")
    return _item("spo2_long", "ok", f"近 {p['recent_days']} 天平均 {m:.1f}%" + (f"，{low} 晚低于 {p['low_percent']}%" if low else ""))


def _breathing(i: int, daily: dict, p: dict) -> dict:
    series = daily.get("breathDist") or []
    recent = _vals(series, i - p["recent_days"] + 1, i)
    prior = _vals(series, i - p["recent_days"] - p["prior_days"] + 1, i - p["recent_days"])
    if len(recent) < p["min_nights"]:
        return _item("breathing_long", "none", f"近 {p['recent_days']} 天有呼吸紊乱读数的夜晚不足 {p['min_nights']} 晚")
    r = _mean(recent)
    if len(prior) < p["min_prior"]:
        return _item("breathing_long", "ok", f"近 {p['recent_days']} 天平均每小时 {r:.1f} 次；更早的数据还不够比较")
    q = _mean(prior)
    if r >= q * p["rise_ratio"] and r - q >= p["rise_per_hour"]:
        return _item("breathing_long", "note", f"近 {p['recent_days']} 天平均每小时 {r:.1f} 次，此前三个月 {q:.1f} 次",
                     f"近 {p['recent_days']} 天睡眠呼吸紊乱平均每小时 {r:.1f} 次，此前三个月是 {q:.1f} 次，升高比较明显。"
                     "体重增加、饮酒、鼻塞、仰卧睡都会让它变多。如果同时有打鼾、憋醒或白天犯困，"
                     "建议咨询医生（呼吸科或睡眠门诊），可以问问是否需要做睡眠监测。")
    return _item("breathing_long", "ok", f"近 {p['recent_days']} 天平均每小时 {r:.1f} 次，此前三个月 {q:.1f} 次，没有明显升高")


def _sleep(i: int, A: dict, p: dict) -> dict:
    weeks = [A["sleep7"][j] for j in range(i, i - 7 * p["weeks"], -7) if j >= 0]
    known = [v for v in weeks if v is not None]
    if len(known) < p["min_weeks"]:
        return _item("sleep_long", "none", f"最近 {p['weeks']} 周里，睡眠记录够用的不足 {p['min_weeks']} 周")
    short = sum(1 for v in known if v < p["weekly_mean_hours"])
    if short >= p["short_weeks"]:
        return _item("sleep_long", "note", f"最近 {p['weeks']} 周里有 {short} 周平均不到 {p['weekly_mean_hours']:g} 小时",
                     f"最近 {p['weeks']} 周里有 {short} 周，手表记录到的平均睡眠不到 {p['weekly_mean_hours']:g} 小时。"
                     "如果是没时间睡，先想办法把睡眠时间腾出来；如果是有时间却睡不着或早醒，"
                     "并且已经持续几个月，可以咨询医生（睡眠门诊）。")
    return _item("sleep_long", "ok", f"最近 {p['weeks']} 周里有 {short} 周平均不到 {p['weekly_mean_hours']:g} 小时")


def _weight(i: int, daily: dict, p: dict) -> dict:
    series = daily.get("weight") or []
    recent = _vals(series, i - p["recent_days"] + 1, i)
    past = _vals(series, i - p["past_to_days"] + 1, i - p["past_from_days"])
    if len(recent) < p["min_recent"]:
        return _item("weight_long", "none", f"近 {p['recent_days']} 天的称重不足 {p['min_recent']} 次")
    r = _mean(recent)
    if len(past) < p["min_past"]:
        return _item("weight_long", "ok", f"近 {p['recent_days']} 天平均 {r:.1f} kg；半年前的称重还不够比较")
    q = _mean(past)
    change = 100 * (r - q) / q
    if change <= -p["loss_percent"]:
        return _item("weight_long", "note", f"近 {p['recent_days']} 天平均 {r:.1f} kg，半年前 {q:.1f} kg",
                     f"近 {p['recent_days']} 天的平均体重是 {r:.1f} kg，比半年前的 {q:.1f} kg 轻了 {-change:.1f}%。"
                     "如果是有意减重，这是成果，不用在意。如果不是，建议咨询医生（全科或内科）；"
                     "这种情况常做的初步检查有血常规、甲状腺功能、肝肾功能等。")
    return _item("weight_long", "ok", f"近 {p['recent_days']} 天平均 {r:.1f} kg，半年前 {q:.1f} kg（{change:+.1f}%）")


def _vitals(i: int, A: dict, p: dict, min_outliers: int) -> dict:
    lo = max(0, i - p["recent_days"] + 1)
    out = A["vitalsOut"][lo: i + 1]
    judged = sum(1 for v in out if v is not None)
    if judged < p["min_nights"]:
        return _item("vitals_repeat", "none", f"近 {p['recent_days']} 天可以判断的夜晚不足 {p['min_nights']} 晚")
    nights = [k for k, v in enumerate(out) if v is not None and v >= min_outliers]
    episodes = sum(1 for n, k in enumerate(nights) if n == 0 or k - nights[n - 1] > p["gap_days"])
    if episodes >= p["episodes"]:
        return _item("vitals_repeat", "note", f"近 {p['recent_days']} 天出现 {episodes} 次，共 {len(nights)} 晚",
                     f"近 {p['recent_days']} 天里有 {episodes} 次、共 {len(nights)} 晚出现多项夜间体征同时偏离。"
                     "偶尔一次很常见；一个月里反复出现，又对不上饮酒、熬夜、生病这些原因的话，下次看医生时可以提一下。")
    return _item("vitals_repeat", "ok", f"近 {p['recent_days']} 天出现 {episodes} 次" if nights else f"近 {p['recent_days']} 天没有出现")


def is_afib(label: str) -> bool:
    """Whether an ECG app classification (as exported, Chinese or English) is atrial fibrillation."""
    low = (label or "").lower()
    return "房颤" in low or "心房颤动" in low or "atrial fibrillation" in low or low.strip() == "afib"


def _ecg(i: int, ecgs: list[dict], p: dict) -> dict:
    recent = [e for e in ecgs if i - p["recent_days"] < e["d"] <= i]
    if not recent:
        return _item("ecg", "none", f"近 {p['recent_days']} 天没有心电图记录")
    flagged = [e for e in recent if is_afib(e.get("cls", ""))]
    if flagged:
        return _item("ecg", "note", f"近 {p['recent_days']} 天 {len(recent)} 份记录，其中 {len(flagged)} 份被归类为“{flagged[-1]['cls']}”",
                     f"近 {p['recent_days']} 天里有 {len(flagged)} 份心电图被 Apple 的心电图 App 归类为“{flagged[-1]['cls']}”。"
                     "按 Apple 的说明，此前没有确诊过的人得到这个结果应当咨询医生。把这些记录带给医生看（心内科）。")
    kinds = "、".join(sorted({e.get("cls") or "未分类" for e in recent}))
    return _item("ecg", "ok", f"近 {p['recent_days']} 天 {len(recent)} 份记录，分类为：{kinds}")


def screen(i: int, *, daily: dict[str, list], analysis: dict[str, list], ecgs: list[dict], params: dict[str, dict]) -> list[dict]:
    """Every long-window check as of day ``i``: [{id, state, fact, text}], in a fixed order.

    state is "note" (worth a mention), "ok", or "none" (not enough data); ``text`` is filled
    only for "note".
    """
    P = params
    return [
        _rhr(i, daily, P["rhr_long"]),
        _spo2(i, daily, P["spo2_long"]),
        _breathing(i, daily, P["breathing_long"]),
        _sleep(i, analysis, P["sleep_long"]),
        _weight(i, daily, P["weight_long"]),
        _vitals(i, analysis, P["vitals_repeat"], P["night_vitals"]["min_outliers"]),
        _ecg(i, ecgs, P["ecg"]),
    ]
