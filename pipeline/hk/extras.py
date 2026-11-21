"""Workouts and ECG recordings."""
from __future__ import annotations

import re
from datetime import datetime, timezone

from .parse import Store, parse_ts
from .source import ExportSource
from .tz import Timeline

WORKOUT_ZH = {
    "TraditionalStrengthTraining": "传统力量训练", "FunctionalStrengthTraining": "功能性力量训练",
    "MixedCardio": "混合有氧", "Running": "跑步", "Walking": "步行", "Cycling": "骑行", "Hiking": "徒步",
    "StairClimbing": "爬楼梯", "Stairs": "楼梯", "HighIntensityIntervalTraining": "高强度间歇",
    "Swimming": "游泳", "Yoga": "瑜伽", "Elliptical": "椭圆机", "Rowing": "划船", "CoreTraining": "核心训练",
    "Cooldown": "整理放松", "Flexibility": "柔韧性", "Pilates": "普拉提", "Dance": "舞蹈",
    "CardioDance": "有氧舞蹈", "SocialDance": "社交舞", "Badminton": "羽毛球", "Basketball": "篮球",
    "Soccer": "足球", "TableTennis": "乒乓球", "Tennis": "网球", "Volleyball": "排球", "JumpRope": "跳绳",
    "Boxing": "拳击", "Kickboxing": "搏击操", "MartialArts": "武术", "TaiChi": "太极", "Climbing": "攀岩",
    "Golf": "高尔夫", "MindAndBody": "身心训练", "CrossTraining": "交叉训练", "StepTraining": "踏步训练",
    "Barre": "芭蕾塑形", "Skating": "滑冰", "SkatingSports": "滑冰", "SnowSports": "雪上运动",
    "Snowboarding": "单板滑雪", "DownhillSkiing": "高山滑雪", "CrossCountrySkiing": "越野滑雪",
    "PaddleSports": "桨类运动", "Pickleball": "匹克球", "Squash": "壁球", "Baseball": "棒球",
    "Rugby": "橄榄球", "Fencing": "击剑", "Gymnastics": "体操", "Handball": "手球", "Hockey": "曲棍球",
    "SurfingSports": "冲浪", "WaterFitness": "水中健身", "WheelchairWalkPace": "轮椅步行",
    "FitnessGaming": "健身游戏", "PreparationAndRecovery": "准备与恢复", "Play": "玩耍", "Other": "其他",
}
_DIST_FACTORS = {"km": 1.0, "mi": 1.609344, "m": 0.001, "yd": 0.0009144}


def _lead_number(text: str | None) -> float | None:
    m = re.match(r"\s*(-?\d+(?:\.\d+)?)", text or "")
    return float(m.group(1)) if m else None


def _hm(ts: int, off: int) -> str:
    return datetime.fromtimestamp(ts + off, timezone.utc).strftime("%H:%M")


def build_workouts(store: Store, tl: Timeline, day0: int, ndays: int) -> list[dict]:
    out = []
    for w in sorted(store.workouts, key=lambda w: w["start"]):
        off = tl.offset(w["start"])
        d = (w["start"] + off) // 86400 - day0
        if not 0 <= d < ndays:
            continue
        minutes = w["duration"]
        if minutes is None:
            minutes = (w["end"] - w["start"]) / 60
        elif w["durationUnit"] in ("hr", "h"):
            minutes *= 60
        elif w["durationUnit"] in ("s", "sec"):
            minutes /= 60
        st = w["stats"]
        hr = st.get("HeartRate", {})
        dist = None
        for key in ("DistanceWalkingRunning", "DistanceCycling", "DistanceSwimming",
                    "DistanceDownhillSnowSports", "DistanceWheelchair"):
            if key in st and st[key].get("sum"):
                dist = st[key]["sum"] * _DIST_FACTORS.get(st[key].get("unit"), 1.0)
                break
        kcal = st.get("ActiveEnergyBurned", {}).get("sum")
        if kcal is not None and st["ActiveEnergyBurned"].get("unit") == "kJ":
            kcal /= 4.184
        meta = w["meta"]
        temp = _lead_number(meta.get("HKWeatherTemperature"))
        if temp is not None and "degF" in (meta.get("HKWeatherTemperature") or ""):
            temp = (temp - 32) / 1.8
        elev = _lead_number(meta.get("HKElevationAscended"))
        if elev is not None and "cm" in (meta.get("HKElevationAscended") or ""):
            elev /= 100
        zones = [round(z[2], 1) for z in w["zones"]]
        bounds = [z[0] for z in w["zones"][1:]] if w["zones"] else []
        out.append({
            "d": d,
            "time": _hm(w["start"], off),
            "key": w["type"],
            "type": WORKOUT_ZH.get(w["type"], w["type"]),
            "min": round(minutes, 1),
            "kcal": round(kcal) if kcal is not None else None,
            "dist": round(dist, 2) if dist else None,
            "hrAvg": round(hr["average"]) if hr.get("average") else None,
            "hrMax": round(hr["maximum"]) if hr.get("maximum") else None,
            "hrMin": round(hr["minimum"]) if hr.get("minimum") else None,
            "mets": round(_lead_number(meta.get("HKAverageMETs")), 1) if _lead_number(meta.get("HKAverageMETs")) else None,
            "effort": w["effort"] if w["effort"] is not None else w["effortEst"],
            "indoor": meta.get("HKIndoorWorkout") == "1",
            "zones": zones,
            "zoneBounds": bounds,
            "tempC": round(temp, 1) if temp is not None else None,
            "elev": round(elev) if elev is not None else None,
            "src": store.sources[w["src"]],
            "tz": meta.get("HKTimeZone"),
        })
    return out


# --- ECG -----------------------------------------------------------------------------

_ECG_KEYS = {
    "date": ("记录日期", "Recorded Date"),
    "cls": ("分类", "Classification"),
    "symptoms": ("症状", "Symptoms"),
    "device": ("设备", "Device"),
    "fs": ("采样速率", "采样率", "Sample Rate"),
    "lead": ("导联", "Lead"),
    "unit": ("单位", "Unit"),
}


def _is_num(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False


def estimate_heart_rate(x: list[float], fs: float) -> int | None:
    """Mean heart rate from R-peak spacing (slope-energy peak picking)."""
    n = len(x)
    if n < fs * 5:
        return None
    energy = [0.0] * n
    for i in range(2, n):
        dx = x[i] - x[i - 2]
        energy[i] = dx * dx
    win = max(1, int(0.10 * fs))
    acc, smooth = 0.0, [0.0] * n
    for i in range(n):
        acc += energy[i]
        if i >= win:
            acc -= energy[i - win]
        smooth[i] = acc / win
    ordered = sorted(smooth)
    thresh = 0.25 * ordered[int(0.98 * (n - 1))]
    refractory = int(0.28 * fs)
    peaks: list[int] = []
    i = 0
    while i < n:
        if smooth[i] > thresh:
            j = i
            best = i
            while j < n and smooth[j] > thresh:
                if smooth[j] > smooth[best]:
                    best = j
                j += 1
            if not peaks or best - peaks[-1] > refractory:
                peaks.append(best)
            i = j
        else:
            i += 1
    if len(peaks) < 6:
        return None
    bpm = 60 * (len(peaks) - 1) / ((peaks[-1] - peaks[0]) / fs)
    return round(bpm) if 30 <= bpm <= 220 else None


def build_ecgs(src: ExportSource, tl: Timeline, day0: int) -> list[dict]:
    out = []
    for name in src.members("electrocardiograms", ".csv"):
        try:
            text = src.read("electrocardiograms", name).decode("utf-8-sig", "replace")
        except OSError:
            continue
        meta: dict[str, str] = {}
        values: list[float] = []
        in_data = False
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            if not in_data and _is_num(line):
                in_data = True
            if in_data:
                if _is_num(line):
                    values.append(float(line))
            elif "," in line:
                k, v = line.split(",", 1)
                meta[k.strip()] = v.strip().strip('"')

        def get(field: str) -> str:
            return next((meta[k] for k in _ECG_KEYS[field] if k in meta), "")

        try:
            ts = parse_ts(get("date"))
        except (ValueError, IndexError):
            continue
        fs = _lead_number(get("fs")) or 512.0
        off = tl.offset(ts)
        out.append({
            "d": (ts + off) // 86400 - day0,
            "date": datetime.fromtimestamp(ts + off, timezone.utc).strftime("%Y-%m-%d"),
            "time": _hm(ts, off),
            "cls": get("cls") or "未分类",
            "symptoms": get("symptoms"),
            "device": get("device"),
            "lead": get("lead"),
            "fs": fs,
            "hr": estimate_heart_rate(values, fs),
            "sec": round(len(values) / fs, 1),
            "uv": [round(v) for v in values],
        })
    out.sort(key=lambda e: (e["date"], e["time"]))
    return out
