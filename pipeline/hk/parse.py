"""Streaming parse of the HealthKit export XML into compact in-memory tables."""
from __future__ import annotations

import calendar
import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from typing import BinaryIO

Q_PREFIX = "HKQuantityTypeIdentifier"
C_PREFIX = "HKCategoryTypeIdentifier"

# Quantity types the dashboard uses. Everything else is only counted for the inventory.
QUANTITY_TYPES = {
    "StepCount", "DistanceWalkingRunning", "DistanceCycling", "ActiveEnergyBurned",
    "BasalEnergyBurned", "FlightsClimbed", "AppleExerciseTime", "AppleStandTime",
    "TimeInDaylight", "DietaryWater",
    "HeartRate", "RestingHeartRate", "WalkingHeartRateAverage", "HeartRateVariabilitySDNN",
    "RespiratoryRate", "OxygenSaturation", "VO2Max",
    "BodyMass", "BodyMassIndex", "BodyFatPercentage", "LeanBodyMass", "Height",
    "AppleSleepingWristTemperature", "AppleSleepingBreathingDisturbances",
    "WalkingSpeed", "WalkingStepLength", "WalkingDoubleSupportPercentage",
    "WalkingAsymmetryPercentage", "AppleWalkingSteadiness", "SixMinuteWalkTestDistance",
    "StairAscentSpeed", "StairDescentSpeed", "HeadphoneAudioExposure",
    "EnvironmentalAudioExposure", "EnvironmentalSoundReduction",
    "PhysicalEffort",                             # METs, written around the clock by the watch
}
CATEGORY_TYPES = {"SleepAnalysis", "AppleStandHour"}
# Loud-sound notifications: the 7-day headphone limit, and the Noise app on the watch.
AUDIO_EVENTS = {"HeadphoneAudioExposureEvent": "headphone", "EnvironmentalAudioExposureEvent": "environment",
                "AudioExposureEvent": "environment"}
AUDIOGRAM = "Audiogram"                           # inventory name of hearing-test results

_DEVICE_FIELD = re.compile(r"(?:^|[<,])\s*(name|manufacturer|model|firmware):([^,>]*)")
_LEAD_NUMBER = re.compile(r"\s*(-?\d+(?:\.\d+)?)")


def device_fields(raw: str | None) -> dict[str, str]:
    """The readable parts of a record's ``device`` attribute.

    '<<HKDevice: 0x7421>, name:AirPods Pro, manufacturer:Apple Inc., model:0x2024, localIdentifier:…>'
    -> {'name': 'AirPods Pro', 'manufacturer': 'Apple Inc.', 'model': '0x2024'}. The local identifier
    (a Bluetooth address) is deliberately not kept.
    """
    if not raw:
        return {}
    return {k: v.strip() for k, v in _DEVICE_FIELD.findall(raw) if v.strip()}

# (type, unit as exported) -> multiplier into the unit the dashboard assumes.
UNIT_FACTORS = {
    ("DistanceWalkingRunning", "mi"): 1.609344, ("DistanceWalkingRunning", "m"): 0.001,
    ("DistanceCycling", "mi"): 1.609344, ("DistanceCycling", "m"): 0.001,
    ("ActiveEnergyBurned", "kJ"): 1 / 4.184, ("BasalEnergyBurned", "kJ"): 1 / 4.184,
    ("ActiveEnergyBurned", "Cal"): 1.0, ("BasalEnergyBurned", "Cal"): 1.0,
    ("BodyMass", "lb"): 0.45359237, ("LeanBodyMass", "lb"): 0.45359237,
    ("BodyMass", "g"): 0.001, ("LeanBodyMass", "g"): 0.001,
    ("Height", "m"): 100.0, ("Height", "in"): 2.54, ("Height", "ft"): 30.48,
    ("WalkingSpeed", "mi/hr"): 1.609344, ("WalkingSpeed", "m/s"): 3.6,
    ("WalkingStepLength", "in"): 2.54, ("WalkingStepLength", "m"): 100.0,
    ("DietaryWater", "L"): 1000.0, ("DietaryWater", "fl_oz_us"): 29.5735,
    ("SixMinuteWalkTestDistance", "km"): 1000.0, ("SixMinuteWalkTestDistance", "mi"): 1609.344,
    ("StairAscentSpeed", "ft/s"): 0.3048, ("StairDescentSpeed", "ft/s"): 0.3048,
    ("AppleExerciseTime", "hr"): 60.0, ("AppleStandTime", "hr"): 60.0, ("TimeInDaylight", "hr"): 60.0,
}

_date_cache: dict[str, int] = {}


def parse_ts(s: str) -> int:
    """'2024-01-15 08:30:00 +0800' -> epoch seconds (UTC)."""
    d = s[:10]
    base = _date_cache.get(d)
    if base is None:
        base = calendar.timegm((int(s[0:4]), int(s[5:7]), int(s[8:10]), 0, 0, 0))
        _date_cache[d] = base
    off = int(s[21:23]) * 3600 + int(s[23:25]) * 60
    if s[20] == "-":
        off = -off
    return base + int(s[11:13]) * 3600 + int(s[14:16]) * 60 + int(s[17:19]) - off


def export_offset(s: str) -> int:
    """UTC offset (seconds) the export file was written in."""
    off = int(s[21:23]) * 3600 + int(s[23:25]) * 60
    return -off if s[20] == "-" else off


class Store:
    """Everything the pipeline needs from one export, in memory."""

    def __init__(self) -> None:
        self.sources: list[str] = []
        self._src_index: dict[str, int] = {}
        # type -> [(start, end, value, src_id)]
        self.quantity: dict[str, list[tuple[int, int, float, int]]] = defaultdict(list)
        # type -> [(start, end, value_name, src_id, tz_name | None)]
        self.category: dict[str, list[tuple[int, int, str, int, str | None]]] = defaultdict(list)
        self.units: dict[str, str] = {}
        self.workouts: list[dict] = []
        self.activity: list[dict] = []
        self.me: dict[str, str] = {}
        self.export_date: str | None = None
        self.locale: str | None = None
        self.tz_hints: list[tuple[int, str]] = []       # explicit HKTimeZone metadata
        self.inventory: dict[str, dict] = {}            # every record type seen
        self.unknown_units: set[tuple[str, str]] = set()
        # headphone audio levels with the headphones they were measured on:
        # [(start, end, dB, src_id, device_id)]
        self.headphones: list[tuple[int, int, float, int, int]] = []
        self.audio_devices: list[dict] = []             # [{name, manufacturer, model}]
        self._dev_index: dict[tuple, int] = {}
        self._dev_raw: dict[str, int] = {}
        self.audiograms: list[dict] = []                # hearing-test results
        self.audio_events: list[dict] = []              # loud-sound notifications

    def src(self, name: str | None) -> int:
        name = (name or "?").replace("\xa0", " ")
        i = self._src_index.get(name)
        if i is None:
            i = self._src_index[name] = len(self.sources)
            self.sources.append(name)
        return i

    def device(self, raw: str | None) -> int:
        """Index of the headphones in a record's ``device`` attribute (same name and model = same pair)."""
        key_raw = raw or ""
        i = self._dev_raw.get(key_raw)
        if i is None:
            f = device_fields(raw)
            key = (f.get("name", ""), f.get("manufacturer", ""), f.get("model", ""))
            i = self._dev_index.get(key)
            if i is None:
                i = self._dev_index[key] = len(self.audio_devices)
                self.audio_devices.append({"name": key[0], "manufacturer": key[1], "model": key[2]})
            self._dev_raw[key_raw] = i
        return i

    def count(self, full: str, start: int, src: int, unit: str | None) -> None:
        """Add one element to the inventory of record types."""
        inv = self.inventory.get(full)
        if inv is None:
            inv = self.inventory[full] = {"n": 0, "first": start, "last": start, "sources": set(), "unit": unit}
        inv["n"] += 1
        if start < inv["first"]:
            inv["first"] = start
        if start > inv["last"]:
            inv["last"] = start
        inv["sources"].add(src)


def _f(x: str | None) -> float | None:
    try:
        return float(x) if x is not None else None
    except ValueError:
        return None


def _workout(el: ET.Element, store: Store) -> dict:
    a = el.attrib
    w: dict = {
        "type": a.get("workoutActivityType", "").replace("HKWorkoutActivityType", ""),
        "start": parse_ts(a["startDate"]),
        "end": parse_ts(a["endDate"]),
        "duration": _f(a.get("duration")),
        "durationUnit": a.get("durationUnit", "min"),
        "src": store.src(a.get("sourceName")),
        "stats": {}, "meta": {}, "zones": [], "effort": None, "effortEst": None, "route": None,
    }
    for c in el:
        if c.tag == "WorkoutStatistics":
            t = c.attrib.get("type", "").replace(Q_PREFIX, "")
            w["stats"][t] = {k: _f(v) for k, v in c.attrib.items() if k in ("sum", "average", "minimum", "maximum")}
            w["stats"][t]["unit"] = c.attrib.get("unit")
        elif c.tag == "MetadataEntry":
            w["meta"][c.attrib.get("key")] = c.attrib.get("value")
        elif c.tag == "WorkoutZoneGroup":
            if c.attrib.get("type", "").endswith("HeartRate"):
                for z in c:
                    if z.tag == "WorkoutZone":
                        w["zones"].append((_f(z.attrib.get("minimum")), _f(z.attrib.get("maximum")), _f(z.attrib.get("duration")) or 0.0))
        elif c.tag == "Record":
            t = c.attrib.get("type", "")
            if t.endswith("EstimatedWorkoutEffortScore"):
                w["effortEst"] = _f(c.attrib.get("value"))
            elif t.endswith("WorkoutEffortScore"):
                w["effort"] = _f(c.attrib.get("value"))
        elif c.tag == "WorkoutRoute":
            for r in c:
                if r.tag == "FileReference":
                    w["route"] = r.attrib.get("path")
    tz = w["meta"].get("HKTimeZone")
    if tz:
        store.tz_hints.append((w["start"], tz))
    return w


def _audiogram(el: ET.Element, store: Store) -> dict:
    """One hearing test: thresholds in dB HL per frequency and ear (None where an ear was not tested)."""
    a = el.attrib
    dev = device_fields(a.get("device"))
    points, meta = [], {}
    for c in el:
        if c.tag == "SensitivityPoint":
            p = c.attrib
            hz = _f(p.get("frequencyValue"))
            if hz is not None:
                points.append({"hz": hz, "left": _f(p.get("leftEarValue")), "right": _f(p.get("rightEarValue")),
                               "leftMasked": p.get("leftEarMasked") == "YES",
                               "rightMasked": p.get("rightEarMasked") == "YES"})
        elif c.tag == "MetadataEntry":
            meta[c.attrib.get("key")] = c.attrib.get("value")
    points.sort(key=lambda p: p["hz"])
    return {"start": parse_ts(a["startDate"]), "end": parse_ts(a["endDate"]), "src": store.src(a.get("sourceName")),
            "device": dev.get("name") or dev.get("model") or "", "firmware": dev.get("firmware"),
            "points": points, "meta": meta}


def _audio_event(el: ET.Element, kind: str, start: int, end: int, src: int) -> dict:
    """A loud-sound notification. The level, when the export carries one, is in its metadata."""
    level = None
    for c in el:
        if c.tag == "MetadataEntry" and "Level" in (c.attrib.get("key") or ""):
            m = _LEAD_NUMBER.match(c.attrib.get("value") or "")
            if m:
                level = float(m.group(1))
                break
    return {"kind": kind, "start": start, "end": end, "src": src,
            "value": el.attrib.get("value", "").replace("HKCategoryValue", ""), "level": level}


def parse_export(fp: BinaryIO, progress=None) -> Store:
    store = Store()
    quantity, category = store.quantity, store.category
    depth = 0
    root = None
    n = 0
    for ev, el in ET.iterparse(fp, events=("start", "end")):
        if ev == "start":
            depth += 1
            if depth == 1:
                root = el
                store.locale = el.attrib.get("locale")
            continue
        depth -= 1
        if depth != 1:
            continue                      # nested element: handled by its top-level parent
        tag = el.tag
        if tag == "Record":
            a = el.attrib
            full = a["type"]
            start = parse_ts(a["startDate"])
            end = parse_ts(a["endDate"])
            src = store.src(a.get("sourceName"))
            store.count(full, start, src, a.get("unit"))

            if full.startswith(Q_PREFIX):
                t = full[len(Q_PREFIX):]
                if t in QUANTITY_TYPES:
                    try:
                        v = float(a["value"])
                    except (KeyError, ValueError):
                        v = None
                    if v is not None:
                        unit = a.get("unit")
                        if t not in store.units:
                            store.units[t] = unit
                        elif unit != store.units[t]:
                            store.unknown_units.add((t, unit))
                        k = UNIT_FACTORS.get((t, unit))
                        if k is not None:
                            v *= k
                        quantity[t].append((start, end, v, src))
                        if t == "HeadphoneAudioExposure":
                            store.headphones.append((start, end, v, src, store.device(a.get("device"))))
            elif full.startswith(C_PREFIX):
                t = full[len(C_PREFIX):]
                if t in CATEGORY_TYPES:
                    tz = None
                    for c in el:
                        if c.tag == "MetadataEntry" and c.attrib.get("key") == "HKTimeZone":
                            tz = c.attrib.get("value")
                            break
                    if tz and t == "SleepAnalysis":
                        store.tz_hints.append((start, tz))
                    val = a.get("value", "")
                    val = val.replace("HKCategoryValueSleepAnalysis", "").replace("HKCategoryValueAppleStandHour", "")
                    category[t].append((start, end, val, src, tz))
                elif t in AUDIO_EVENTS:
                    store.audio_events.append(_audio_event(el, AUDIO_EVENTS[t], start, end, src))
        elif tag == "Audiogram":
            test = _audiogram(el, store)
            store.audiograms.append(test)
            store.count(AUDIOGRAM, test["start"], test["src"], "dBHL")
        elif tag == "Workout":
            store.workouts.append(_workout(el, store))
        elif tag == "ActivitySummary":
            store.activity.append(dict(el.attrib))
        elif tag == "Me":
            store.me = dict(el.attrib)
        elif tag == "ExportDate":
            store.export_date = el.attrib.get("value")
        el.clear()
        n += 1
        if n % 20000 == 0:
            root.clear()                  # drop the emptied shells so memory stays flat
            if progress and n % 200000 == 0:
                progress(n)
    return store
