"""Backtest helpers: threshold sensitivity and the comparison with annotations (made-up data)."""
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))

from hk import backtest as B                                       # noqa: E402
from hk.analysis import build_analysis, series_info                # noqa: E402
from hk.reference import load_reference, params_by_id              # noqa: E402

REF = load_reference()
PARAMS = params_by_id(REF)


class Sensitivity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from test_analysis import made_up_data
        _labels, daily, kind, segs, workouts = made_up_data(n=200)
        days = [(date(2025, 1, 6) + timedelta(days=k)).isoformat() for k in range(200)]
        A = build_analysis(days=days, daily=daily, sleep_kind=kind, sleep_segments=segs, workouts=workouts,
                           params=PARAMS, sleep_need=8.0)["daily"]
        cls.out = B.sensitivity(days=days, daily=daily, analysis=A, workouts=workouts, params=PARAMS,
                                scores=REF["scores"], sleep_need=8.0)

    def variant(self, indicator):
        return next(v for v in self.out["variants"] if v["indicator"] == indicator)

    def test_every_variant_marks_the_value_in_use(self):
        self.assertEqual(len(self.out["variants"]), 8)
        for v in self.out["variants"]:
            self.assertEqual(sum(r["current"] for r in v["rows"]), 1, v["indicator"])
            self.assertTrue(all(0 <= r["count"] <= v["of"] for r in v["rows"]), v["indicator"])
        self.assertGreater(self.out["reports"], 20)
        self.assertGreater(self.out["nights"], 100)

    def counts(self, indicator):
        return [r["count"] for r in self.variant(indicator)["rows"]]

    def test_stricter_thresholds_never_fire_more_often(self):
        for indicator in ("night_vitals", "night_hr_rise", "hrv_night", "training_load"):   # loosest first
            c = self.counts(indicator)
            self.assertEqual(c, sorted(c, reverse=True), indicator)
        for indicator in ("steps", "sleep_duration", "sleep_debt"):               # a higher bar catches more weeks
            c = self.counts(indicator)
            self.assertEqual(c, sorted(c), indicator)
        self.assertGreater(self.counts("steps")[-1], self.counts("steps")[0])


class Annotations(unittest.TestCase):
    def setUp(self):
        n = 40
        self.A = {k: [None] * n for k in series_info(PARAMS, 8.0)}
        self.A["vitalsOut"] = [0] * n
        for j in (10, 20):
            self.A["vitalsOut"][j] = 2
        self.A["zSleepHr"] = [0.0] * n
        for j in (9, 10, 30, 31):
            self.A["zSleepHr"][j] = 2.0
        self.notes = [
            {"d": 9, "tags": ["饮酒"], "note": "聚餐"},               # shows in the night that ends on day 10
            {"d": 20, "tags": ["生病", "熬夜"], "note": ""},
            {"d": 30, "tags": ["饮酒"], "note": ""},                  # nothing flagged around it
        ]

    def test_flagged_nights_pick_up_notes_from_that_day_or_the_day_before(self):
        got = B.annotation_check(self.notes, self.A, PARAMS)
        self.assertEqual(got["annotated"], 3)
        self.assertEqual(got["flagged"], [{"d": 10, "tags": ["饮酒"], "note": "聚餐"},
                                          {"d": 20, "tags": ["生病", "熬夜"], "note": ""}])

    def test_each_tag_counts_how_often_a_flag_came_with_it(self):
        rows = {r["tag"]: r for r in B.annotation_check(self.notes, self.A, PARAMS)["tags"]}
        self.assertEqual((rows["饮酒"]["days"], rows["饮酒"]["judged"], rows["饮酒"]["hits"]), (2, 2, 1))
        self.assertEqual((rows["生病"]["days"], rows["生病"]["hits"]), (1, 1))
        self.assertEqual(rows["饮酒"]["z"]["sleepHr"], 2.0)          # four nights around the two days, all +2
        self.assertIsNone(rows["生病"]["z"]["sleepHr"])              # two nights: too few to average

    def test_runs_of_high_heart_rate_nights_pick_up_notes_too(self):
        self.A["hrRise"] = [0.0] * 40
        self.A["hrBase"] = [58.0] * 40
        self.A["hrRun"] = [0] * 40
        for j, r in ((9, 1), (10, 2), (11, 3)):
            self.A["hrRise"][j], self.A["hrRun"][j] = 5.0, r
        got = B.annotation_check(self.notes, self.A, PARAMS)
        self.assertEqual(got["hrRuns"], [{"start": 9, "end": 11, "nights": 3, "rise": 5.0, "tags": ["饮酒"], "note": "聚餐"}])
        rows = {r["tag"]: r for r in got["tags"]}
        self.assertEqual((rows["饮酒"]["hrJudged"], rows["饮酒"]["hrHits"]), (2, 1))

    def test_no_annotations(self):
        got = B.annotation_check([], self.A, PARAMS)
        self.assertEqual((got["annotated"], got["tags"]), (0, []))
        self.assertEqual([x["d"] for x in got["flagged"]], [10, 20])
        self.assertEqual(got["flagged"][0]["tags"], [])


if __name__ == "__main__":
    unittest.main()
