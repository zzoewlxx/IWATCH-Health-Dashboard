"""Headphones and hearing, on made-up samples: overlaps, sound dose, sessions, hearing tests, parsing."""
import io
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from hk import audio as AU                                          # noqa: E402
from hk.parse import Store, device_fields, parse_export, parse_ts   # noqa: E402
from hk.reference import load_reference, params_by_id               # noqa: E402
from hk.tz import DAY, Timeline                                     # noqa: E402
from test_report import Week                                        # noqa: E402

P = params_by_id(load_reference())
T0 = parse_ts("2025-03-03 00:00:00 +0800")                          # a Monday, local midnight
TL = Timeline([[T0 - DAY, "UTC+08:00", "default"]], T0 + 30 * DAY, 8 * 3600)
DAY0 = TL.local_day(T0)
H = 3600


def store_with(samples, devices=("AirPods Pro|Apple Inc.|0x2024",), sources=("iPhone",)):
    """samples: (start offset s, end offset s, dB, source index, device index), offsets from T0."""
    st = Store()
    for name in sources:
        st.src(name)
    for raw in devices:
        name, maker, model = raw.split("|")
        st.device(f"<<HKDevice: 0x1>, name:{name}, manufacturer:{maker}, model:{model}, localIdentifier:AA:BB>")
    for a, b, v, src, dev in samples:
        st.headphones.append((T0 + a, T0 + b, v, src, dev))
    return st


class Arithmetic(unittest.TestCase):
    def test_the_who_reference_is_one_hundred_percent(self):
        self.assertAlmostEqual(AU.dose_percent(40 * H, 80, 80, 40), 100)
        self.assertAlmostEqual(AU.dose_percent(4 * H, 90, 80, 40), 100)        # WHO: 90 dB, 4 hours a week
        self.assertAlmostEqual(AU.dose_percent(20 * H, 83, 80, 40), 100, delta=0.3)  # 3 dB louder halves the time
        self.assertAlmostEqual(AU.weekly_hours(85, 80, 40), 12.65, places=2)

    def test_levels_average_as_energy(self):
        self.assertAlmostEqual(AU.energy_mean([(H, 70), (H, 60)]), 67.4, places=1)
        self.assertIsNone(AU.energy_mean([]))

    def test_overlapping_samples_count_once(self):
        spans = AU.effective([(0, 100, 60, 0, 0), (50, 150, 70, 0, 0), (60, 80, 90, 0, 0), (200, 200, 50, 0, 0)])
        self.assertEqual([(s, e, v) for s, e, v, _src, _dev in spans], [(0, 100, 60), (100, 150, 70)])


class Headphones(unittest.TestCase):
    def build(self, st, ndays=3):
        return AU.build_headphones(st, TL, DAY0, ndays, P["headphone_dose"])

    def test_daily_time_level_and_dose(self):
        st = store_with([(8 * H, 9 * H, 70, 0, 0), (8 * H + 1800, 9 * H, 70, 0, 0),   # overlap counts once
                         (10 * H, 11 * H, 60, 0, 0),
                         (DAY + 9 * H, DAY + 13 * H, 90, 0, 0)])
        out = self.build(st)
        d = out["daily"]
        self.assertEqual(d["listenMin"], [120.0, 240.0, 0.0])
        self.assertAlmostEqual(d["headphone"][0], 67.4, places=1)
        self.assertEqual(d["headphone"][2], None)
        self.assertAlmostEqual(d["hpDose"][1], 100, places=2)                   # 4 h at 90 dB
        self.assertAlmostEqual(d["hpDose7"][2], d["hpDose"][0] + d["hpDose"][1], places=2)
        self.assertEqual(out["hourly"][0][8], 60.0)
        self.assertEqual(sum(out["bins"][1]), 240.0)
        self.assertEqual(out["bins"][1][-1], 240.0)                              # >= 90 dB bin

    def test_a_sample_across_midnight_is_split(self):
        st = store_with([(DAY - 600, DAY + 1200, 60, 0, 0)])
        out = self.build(st)
        self.assertEqual(out["daily"]["listenMin"][:2], [10.0, 20.0])
        self.assertEqual(out["samples"][0], [1430.0, 1440.0, 60.0])
        self.assertEqual(out["samples"][1], [0.0, 20.0, 60.0])

    def test_days_before_the_first_sample_have_no_value(self):
        out = self.build(store_with([(DAY + 3600, DAY + 7200, 60, 0, 0)]))
        self.assertEqual(out["daily"]["listenMin"], [None, 60.0, 0.0])
        self.assertEqual(out["daily"]["hpDose7"][0], None)

    def test_sessions_split_on_long_pauses_and_new_headphones(self):
        gap = P["headphone_dose"]["session_gap_min"] * 60
        st = store_with([(0, 600, 60, 0, 0), (600 + gap - 60, 1800, 60, 0, 0),        # short pause: same session
                         (1800 + gap + 60, 2400, 60, 0, 0),                            # long pause: new session
                         (2400, 3000, 75, 0, 1)],                                      # other headphones: new session
                        devices=("AirPods Pro|Apple Inc.|0x2024", "WH-1000XM4||"))
        out = self.build(st)
        self.assertEqual([s[2] for s in out["sessions"]], [30.0, 4.0, 10.0])           # span minutes
        self.assertEqual([s[5] for s in out["sessions"]], [0, 0, 1])
        self.assertEqual(out["sessions"][0][3], 26.0)                                  # minutes actually playing

    def test_headphones_are_ranked_by_listening_time(self):
        st = store_with([(0, 600, 60, 0, 0), (H, 3 * H, 65, 1, 1)],
                        devices=("WH-1000XM4||", "AirPods Pro|Apple Inc.|0x2024"), sources=("iPhone", "iPad"))
        out = self.build(st)
        self.assertEqual([x["label"] for x in out["devices"]], ["AirPods Pro 2（USB-C）", "WH-1000XM4"])
        self.assertEqual(out["devices"][0]["minutes"], 120)
        self.assertEqual(out["devices"][0]["sources"], [["iPad", 120]])
        self.assertEqual(out["devDaily"][0][0], 120.0)
        # each pair also gets its own level, dose, hours and level bins, so the page can show it alone
        self.assertEqual(out["devDb"][0][:2], [65.0, None])
        self.assertEqual(out["devDb"][1][0], 60.0)
        self.assertAlmostEqual(out["devDose"][0][0], AU.dose_percent(2 * H, 65, 80, 40), places=3)
        self.assertEqual(out["devHourly"][0][0][1:3], [60.0, 60.0])
        self.assertIsNone(out["devHourly"][1][1])
        self.assertEqual(sum(out["devBins"][1][0]), 10.0)


class HearingTests(unittest.TestCase):
    p = P["hearing_test"]

    def test_pure_tone_average_needs_all_four_frequencies(self):
        pts = [{"hz": f, "left": v, "right": None} for f, v in ((500, 10), (1000, 20), (2000, 30), (4000, 40), (8000, 80))]
        self.assertEqual(AU.pure_tone_average(pts, "left", self.p["pta_freqs"]), 25)
        self.assertIsNone(AU.pure_tone_average(pts, "right", self.p["pta_freqs"]))

    def test_grades_use_the_rounded_value(self):
        g = self.p["grades"]
        self.assertEqual(AU.hearing_grade(25.4, g), "基本没有听力损失")
        self.assertEqual(AU.hearing_grade(25.6, g), "轻度听力损失")
        self.assertEqual(AU.hearing_grade(95, g), "极重度听力损失")
        self.assertIsNone(AU.hearing_grade(None, g))

    def test_change_against_the_previous_test(self):
        st = Store()
        src = st.src("设置")
        for k, shift in enumerate((0, 12)):
            st.audiograms.append({"start": T0 + k * DAY, "end": T0 + k * DAY + 300, "src": src, "device": "AirPods Pro",
                                  "points": [{"hz": f, "left": 5 + shift, "right": 8, "leftMasked": False, "rightMasked": False}
                                             for f in (250, 500, 1000, 2000, 4000, 8000)], "meta": {}})
        tests = AU.build_hearing_tests(st, TL, DAY0, self.p)
        self.assertEqual([t["pta"] for t in tests], [[5, 8], [17, 8]])
        self.assertIsNone(tests[0]["change"])
        self.assertEqual(tests[1]["change"], [12, 0])
        self.assertEqual(tests[1]["date"], "2025-03-04")


EXPORT = """<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="zh_CN">
 <ExportDate value="2025-03-05 12:00:00 +0800"/>
 <Record type="HKQuantityTypeIdentifierHeadphoneAudioExposure" sourceName="iPhone" device="&lt;&lt;HKDevice: 0x1&gt;, name:AirPods Pro, manufacturer:Apple Inc., model:0x2014, localIdentifier:11:22:33:44:55:66-tacl, creation date:2025-01-01 00:00:00 +0000&gt;" unit="dBASPL" startDate="2025-03-03 08:00:00 +0800" endDate="2025-03-03 08:30:00 +0800" value="62.5"/>
 <Record type="HKCategoryTypeIdentifierHeadphoneAudioExposureEvent" sourceName="iPhone" startDate="2025-03-04 20:00:00 +0800" endDate="2025-03-04 20:00:00 +0800" value="HKCategoryValueHeadphoneAudioExposureEventSevenDayLimit">
  <MetadataEntry key="HKMetadataKeyAudioExposureLevel" value="88.2 dBASPL"/>
 </Record>
 <Audiogram type="HKDataTypeIdentifierAudiogram" sourceName="设置" device="&lt;&lt;HKDevice: 0x2&gt;, name:AirPods Pro, model:AirPods Pro, firmware:6F21, localIdentifier:11:22&gt;" startDate="2025-03-04 16:00:00 +0800" endDate="2025-03-04 16:07:00 +0800">
  <MetadataEntry key="HKAlgorithmVersion" value="1"/>
  <SensitivityPoint frequencyValue="1000" frequencyUnit="Hz" leftEarValue="12.5" leftEarUnit="dBHL" leftEarMasked="NO" rightEarValue="7" rightEarUnit="dBHL" rightEarMasked="NO"/>
  <SensitivityPoint frequencyValue="500" frequencyUnit="Hz" leftEarValue="10" leftEarUnit="dBHL" leftEarMasked="NO"/>
 </Audiogram>
</HealthData>
"""


class Parsing(unittest.TestCase):
    def test_device_fields_leave_out_the_bluetooth_address(self):
        f = device_fields("<<HKDevice: 0x1>, name:WH-1000XM4, localIdentifier:AA:BB:CC:DD, creation date:2024>")
        self.assertEqual(f, {"name": "WH-1000XM4"})
        self.assertEqual(AU.device_label({"name": "AirPods Pro", "model": "0x2014"}), "AirPods Pro 2")
        self.assertEqual(AU.device_label({"name": "", "model": ""}), "未知耳机")

    def test_headphones_notifications_and_audiograms_are_read(self):
        st = parse_export(io.BytesIO(EXPORT.encode("utf-8")))
        self.assertEqual(len(st.headphones), 1)
        self.assertEqual(st.headphones[0][2], 62.5)
        self.assertEqual(st.audio_devices, [{"name": "AirPods Pro", "manufacturer": "Apple Inc.", "model": "0x2014"}])
        self.assertEqual(len(st.quantity["HeadphoneAudioExposure"]), 1)
        self.assertEqual([(e["kind"], e["level"]) for e in st.audio_events], [("headphone", 88.2)])
        a = st.audiograms[0]
        self.assertEqual(a["device"], "AirPods Pro")
        self.assertEqual([(p["hz"], p["left"], p["right"]) for p in a["points"]], [(500, 10, None), (1000, 12.5, 7)])
        self.assertEqual(st.inventory["Audiogram"]["n"], 1)


class WeeklyReport(unittest.TestCase):
    def week(self, minutes, db):
        w = Week()
        n = len(w.daily["sleepTotal"])
        dose = AU.dose_percent(minutes * 60, db, 80, 40)
        w.daily.update({"listenMin": [minutes] * n, "headphone": [db] * n, "hpDose": [dose] * n})
        return w

    def test_a_loud_week_gets_one_calm_suggestion(self):
        w = self.week(6 * 60, 85)                                   # 6 h a day at 85 dB: about 330 %
        tip = next(t for t in w.last()["tips"] if t["id"] == "headphone_loud")
        self.assertEqual(tip["basis"], ["headphone_dose"])
        self.assertIn("调低一两格", tip["text"])
        self.assertEqual(w.last()["hearing"]["db"], 85)

    def test_an_ordinary_week_gets_none(self):
        w = self.week(2 * 60, 60)
        self.assertNotIn("headphone_loud", w.tip_ids())
        self.assertLess(w.last()["hearing"]["dose"], 1)

    def test_weeks_without_headphone_data_are_unaffected(self):
        self.assertEqual(Week().last()["hearing"], {"minutes": None, "db": None, "dose": None})


if __name__ == "__main__":
    unittest.main()
