"""The evidence table must stay complete: every entry sourced, graded and usable by the code."""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))

from hk import analysis as A                                        # noqa: E402
from hk.reference import load_reference, params_by_id, validate     # noqa: E402

USED_BY_ANALYSIS = {
    "hrv_night", "rhr", "night_vitals", "night_hr_rise", "sleep_duration", "sleep_debt", "sleep_regularity",
    "sleep_timing_variability", "steps", "activity_minutes", "activity_pattern", "strength_days", "training_load",
    "vo2max_peers", "noise_band", "own_comparisons",
}


class ReferenceTable(unittest.TestCase):
    def setUp(self):
        self.ref = load_reference()

    def test_the_shipped_table_is_valid(self):
        self.assertEqual(validate(self.ref), [])

    def test_analysis_finds_every_parameter_it_reads(self):
        params = params_by_id(self.ref)
        self.assertLessEqual(USED_BY_ANALYSIS, set(params))
        info = A.series_info(params, params["sleep_debt"]["need_hours"])     # reads the windows it prints
        self.assertTrue(all(label for label, _unit in info.values()))

    def test_every_entry_cites_a_source_and_says_how_it_was_checked(self):
        entries = self.ref["indicators"] + self.ref["excluded"]
        self.assertGreaterEqual(len(self.ref["indicators"]), 10)
        for entry in entries:
            self.assertTrue(entry["sources"], entry.get("id") or entry["name"])
            for s in entry["sources"]:
                self.assertTrue(s["url"].startswith("https://"), s["url"])
                self.assertIn(s["checked"], self.ref["checked"])

    def test_problems_are_reported_in_words(self):
        broken = copy.deepcopy(self.ref)
        broken["indicators"][0]["grade"] = "S"
        broken["indicators"][1]["sources"] = []
        broken["indicators"][2]["id"] = broken["indicators"][3]["id"]
        del broken["excluded"][0]["sources"][0]["url"]
        problems = validate(broken)
        self.assertEqual(len(problems), 4, problems)
        self.assertTrue(any("grade" in p for p in problems))
        self.assertTrue(any("至少要有一条出处" in p for p in problems))
        self.assertTrue(any("id 重复" in p for p in problems))

    def test_score_definitions_are_checked(self):
        self.assertEqual({p["key"] for p in self.ref["scores"]["sleep"]["parts"]}, {"duration", "regularity"})
        broken = copy.deepcopy(self.ref)
        broken["scores"]["sleep"]["parts"][0]["max"] = 70                   # no longer adds up to 100
        broken["scores"]["activity"]["parts"][0]["curve"] = [[7000, 1], [2000, 0]]
        broken["scores"]["activity"]["parts"][1]["indicator"] = "no_such_indicator"
        problems = validate(broken)
        self.assertEqual(len(problems), 3, problems)
        self.assertTrue(any("加起来应是 100" in p for p in problems))
        self.assertTrue(any("curve" in p for p in problems))

    def test_missing_sections_are_caught_first(self):
        self.assertEqual(validate({"indicators": []})[0], "缺少顶层字段 about")


if __name__ == "__main__":
    unittest.main()
