"""Long-window checks, on made-up records."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))

from hk import screening as S                                      # noqa: E402
from hk.reference import load_reference, params_by_id              # noqa: E402

PARAMS = params_by_id(load_reference())
N = 240
LAST = N - 1


class Record:
    """Eight steady months; tests then change the last weeks."""

    def __init__(self):
        self.daily = {"rhr": [60] * N, "sleepSpo2": [96.5] * N, "breathDist": [2.0] * N, "weight": [None] * N}
        self.A = {"sleep7": [7.5] * N, "vitalsOut": [0] * N}
        self.ecgs = []

    def last(self, key, days, value):
        self.daily[key][N - days:] = [value] * days
        return self

    def screen(self, i=LAST):
        return {x["id"]: x for x in S.screen(i, daily=self.daily, analysis=self.A, ecgs=self.ecgs, params=PARAMS)}

    def state(self, cid):
        return self.screen()[cid]["state"]


class Steady(unittest.TestCase):
    def test_nothing_to_mention(self):
        got = Record().screen()
        self.assertEqual(list(got), ["rhr_long", "spo2_long", "breathing_long", "sleep_long", "weight_long", "vitals_repeat", "ecg"])
        self.assertEqual({k: v["state"] for k, v in got.items()},
                         {"rhr_long": "ok", "spo2_long": "ok", "breathing_long": "ok", "sleep_long": "ok",
                          "weight_long": "none", "vitals_repeat": "ok", "ecg": "none"})
        self.assertTrue(all(v["fact"] and not v["text"] for v in got.values()))

    def test_metrics_a_device_never_recorded_are_just_missing(self):
        got = {x["id"]: x["state"] for x in S.screen(LAST, daily={}, analysis={"sleep7": [None] * N, "vitalsOut": [None] * N},
                                                     ecgs=[], params=PARAMS)}
        self.assertEqual(set(got.values()), {"none"})


class RestingHeartRate(unittest.TestCase):
    def test_a_month_clearly_above_the_three_before(self):
        got = Record().last("rhr", 30, 66).screen()["rhr_long"]
        self.assertEqual(got["state"], "note")
        self.assertIn("高了 6", got["text"])
        self.assertEqual(Record().last("rhr", 30, 64).state("rhr_long"), "ok")

    def test_above_the_usual_adult_range(self):
        r = Record()
        r.daily["rhr"] = [102] * N
        self.assertIn("60 到 100", r.screen()["rhr_long"]["text"])

    def test_not_enough_days(self):
        r = Record()
        r.daily["rhr"] = [None] * (N - 5) + [60] * 5
        self.assertEqual(r.state("rhr_long"), "none")
        r.daily["rhr"] = [None] * (N - 30) + [60] * 30               # a first month: nothing earlier to compare with
        self.assertEqual(r.state("rhr_long"), "ok")
        self.assertIn("还不够比较", r.screen()["rhr_long"]["fact"])


class OxygenAndBreathing(unittest.TestCase):
    def test_several_low_nights(self):
        self.assertEqual(Record().last("sleepSpo2", 5, 88.0).state("spo2_long"), "note")
        self.assertEqual(Record().last("sleepSpo2", 4, 88.0).state("spo2_long"), "ok")
        self.assertEqual(Record().last("sleepSpo2", 30, 91.5).state("spo2_long"), "note")     # none below 90, but a low month

    def test_breathing_disturbances_need_a_clear_rise_both_ways(self):
        self.assertEqual(Record().last("breathDist", 30, 6.0).state("breathing_long"), "note")
        self.assertEqual(Record().last("breathDist", 30, 4.0).state("breathing_long"), "ok")  # doubled, but only +2 an hour
        r = Record()
        r.daily["breathDist"] = [10.0] * N
        self.assertEqual(r.last("breathDist", 30, 14.0).state("breathing_long"), "ok")        # +4 an hour, but only 1.4x


class SleepAndWeight(unittest.TestCase):
    def test_three_short_weeks_out_of_four(self):
        r = Record()
        for j in (LAST, LAST - 7, LAST - 14):
            r.A["sleep7"][j] = 5.5
        self.assertEqual(r.state("sleep_long"), "note")
        r.A["sleep7"][LAST - 14] = 6.5
        self.assertEqual(r.state("sleep_long"), "ok")
        for j in (LAST, LAST - 7):
            r.A["sleep7"][j] = None
        self.assertEqual(r.state("sleep_long"), "none")

    def test_weight_lost_without_meaning_to(self):
        r = Record()
        r.daily["weight"][N - 200:N - 160] = [80.0] * 40
        r.last("weight", 10, 75.5)
        got = r.screen()["weight_long"]
        self.assertEqual(got["state"], "note")
        self.assertIn("轻了 5.6%", got["text"])
        self.assertIn("如果是有意减重", got["text"])
        self.assertEqual(r.last("weight", 10, 77.0).state("weight_long"), "ok")               # 3.8% down
        self.assertEqual(r.last("weight", 10, 86.0).state("weight_long"), "ok")               # gain is not flagged here


class VitalsAndEcg(unittest.TestCase):
    def test_nights_close_together_count_once(self):
        r = Record()
        for k in (2, 3, 10, 20):
            r.A["vitalsOut"][N - 30 + k] = 2
        got = r.screen()["vitals_repeat"]
        self.assertEqual(got["state"], "note")
        self.assertIn("3 次、共 4 晚", got["text"])
        r = Record()
        for k in (2, 3, 4, 10):
            r.A["vitalsOut"][N - 30 + k] = 2
        self.assertEqual(r.state("vitals_repeat"), "ok")

    def test_ecg_classifications_are_passed_on_not_interpreted(self):
        r = Record()
        r.ecgs = [{"d": LAST - 200, "cls": "心房颤动"}, {"d": LAST - 20, "cls": "窦性心律"}, {"d": LAST - 3, "cls": "不确定"}]
        got = r.screen()["ecg"]
        self.assertEqual(got["state"], "ok")                                                  # the old one is outside 180 days
        self.assertIn("2 份记录", got["fact"])
        r.ecgs.append({"d": LAST - 1, "cls": "心房颤动"})
        got = r.screen()["ecg"]
        self.assertEqual(got["state"], "note")
        self.assertIn("归类为“心房颤动”", got["text"])
        self.assertIn("按 Apple 的说明", got["text"])
        for label in ("房颤", "Atrial Fibrillation", "AFib"):
            self.assertTrue(S.is_afib(label), label)
        for label in ("窦性心律", "Sinus Rhythm", "不确定", ""):
            self.assertFalse(S.is_afib(label), label)


class WordingAndTime(unittest.TestCase):
    def everything(self):
        r = Record().last("rhr", 30, 67).last("sleepSpo2", 30, 89.0).last("breathDist", 30, 7.0)
        r.daily["weight"][N - 200:N - 160] = [80.0] * 40
        r.last("weight", 10, 74.0)
        for j in (LAST, LAST - 7, LAST - 14, LAST - 21):
            r.A["sleep7"][j] = 5.2
        for k in (1, 9, 17, 25):
            r.A["vitalsOut"][N - 30 + k] = 3
        r.ecgs = [{"d": LAST - 2, "cls": "心房颤动"}]
        return r

    def test_no_alarm_and_no_diagnosis(self):
        got = self.everything().screen()
        self.assertEqual({v["state"] for v in got.values()}, {"note"})
        text = "".join(v["fact"] + v["text"] for v in got.values())
        for word in ("警告", "危险", "异常", "严重", "必须", "立即", "！", "你患有", "确诊为", "说明你"):
            self.assertNotIn(word, text)

    def test_a_check_only_looks_backwards(self):
        r = self.everything()
        before = r.screen(i=180)
        for key in r.daily:
            r.daily[key][181:] = [None] * (N - 181)
        r.A = {k: v[:181] + [None] * (N - 181) for k, v in r.A.items()}
        r.ecgs = []
        after = r.screen(i=180)
        self.assertEqual({k: (v["state"], v["fact"]) for k, v in before.items() if k != "ecg"},
                         {k: (v["state"], v["fact"]) for k, v in after.items() if k != "ecg"})


if __name__ == "__main__":
    unittest.main()
