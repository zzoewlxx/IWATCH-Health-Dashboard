"""Weekly reports: scores, states and suggestions, on made-up weeks."""
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))

from hk import report as R                                         # noqa: E402
from hk.analysis import series_info                                # noqa: E402
from hk.reference import load_reference, params_by_id              # noqa: E402

REF = load_reference()
PARAMS = params_by_id(REF)
SCORES = REF["scores"]
KEYS = list(series_info(PARAMS, 8.0))
N = 14                                                             # two weeks, Monday 2025-02-24 .. Sunday 2025-03-09
DAYS = [(date(2025, 2, 24) + timedelta(days=k)).isoformat() for k in range(N)]
LAST = range(7, 14)                                                # the week the last report covers


class Week:
    """A made-up fortnight whose second week is healthy by every measure; tests then spoil one thing."""

    def __init__(self):
        self.A = {k: [None] * N for k in KEYS}
        self.daily = {k: [None] * N for k in ("sleepTotal", "bedtime", "waketime", "sleepCut")}
        self.workouts = []
        for j in LAST:
            self.daily["sleepTotal"][j], self.daily["bedtime"][j], self.daily["waketime"][j] = 7.6, -30, 430
            self.daily["sleepCut"][j] = 0
            for key, v in (("hrvZ", 0.1), ("rhrZ", 0.0), ("vitalsOut", 0), ("vitalsN", 5)):
                self.A[key][j] = v
        self.set(hrv7=55.0, hrvBase=55.0, hrvLo=48.0, hrvHi=63.0, rhr7=60.0, rhrBase=60.0, rhrHi=65.0,
                 sleep7=7.6, shortNights7=0, sleepDebt14=5.6, sri7=88.0, sri28=85.0, bedSd7=25, durSd7=40,
                 steps7=8200, exercise7=200, strengthDays7=2, load7=1500, loadBase=1500, loadRatio=1.0,
                 daysSinceWorkout=1)

    def set(self, **values):
        for key, v in values.items():
            self.A[key][N - 1] = v
        return self

    def reports(self, partial_day=None):
        return R.build_reports(days=DAYS, daily=self.daily, analysis=self.A, workouts=self.workouts,
                               params=PARAMS, scores=SCORES, partial_day=partial_day)

    def last(self):
        return self.reports()[-1]

    def tip_ids(self):
        return [t["id"] for t in self.last()["tips"]]


class Helpers(unittest.TestCase):
    def test_interpolate_is_flat_outside_the_curve(self):
        curve = [[5, 0], [7, 1]]
        self.assertEqual([R.interpolate(curve, x) for x in (4, 5, 6, 7, 9)], [0, 0, 0.5, 1, 1])
        self.assertAlmostEqual(R.interpolate([[50, 0], [71.6, 0.5], [87.3, 1]], 79.45), 0.75)

    def test_reports_are_built_for_sundays_and_the_latest_day(self):
        self.assertEqual(R.report_days(DAYS), [6, 13])
        self.assertEqual(R.report_days(DAYS[:11]), [6, 10])        # Thursday: the latest day gets one too
        self.assertEqual(R.report_days(DAYS[:6]), [])              # no full week yet
        self.assertEqual(R.report_days(DAYS[1:8]), [6])            # Tuesday..Monday: no Sunday with a week behind it

    def test_texts(self):
        self.assertEqual(R.hours_text(7.31), "7 小时 19 分")
        self.assertEqual(R.hours_text(8.0), "8 小时")
        self.assertEqual(R.day_text("2025-03-08"), "3 月 8 日（周六）")


class Scores(unittest.TestCase):
    def test_full_marks_at_the_guideline(self):
        self.assertEqual(R.score(SCORES["sleep"], {"duration": 7.0, "regularity": 87.3})["score"], 100)
        self.assertEqual(R.score(SCORES["activity"], {"steps": 7000, "exercise": 150, "strength": 2})["score"], 100)
        self.assertEqual(R.score(SCORES["sleep"], {"duration": 9.5, "regularity": 99})["score"], 100)

    def test_parts_add_up(self):
        got = R.score(SCORES["sleep"], {"duration": 6.0, "regularity": 71.6})
        self.assertEqual(got["score"], 50)
        self.assertEqual([(p["key"], p["points"], p["max"]) for p in got["parts"]],
                         [("duration", 30, 60), ("regularity", 20, 40)])
        self.assertFalse(got["partial"])
        got = R.score(SCORES["activity"], {"steps": 5000, "exercise": 75, "strength": 1})
        self.assertEqual(got["score"], 20 + 20 + 10)

    def test_a_missing_part_is_left_out_and_the_rest_rescaled(self):
        got = R.score(SCORES["sleep"], {"duration": 6.0, "regularity": None})
        self.assertEqual((got["score"], got["partial"]), (50, True))
        self.assertIsNone(got["parts"][1]["points"])
        got = R.score(SCORES["activity"], {"steps": 7000, "exercise": None, "strength": None})   # phone only
        self.assertEqual((got["score"], got["partial"]), (100, True))

    def test_no_score_from_too_little(self):
        self.assertIsNone(R.score(SCORES["activity"], {"steps": None, "exercise": None, "strength": 2})["score"])
        self.assertIsNone(R.score(SCORES["sleep"], {"duration": None, "regularity": None})["score"])


class GoodWeek(unittest.TestCase):
    def test_nothing_to_suggest(self):
        r = Week().last()
        self.assertEqual(r["tips"], [])
        self.assertEqual((r["sleep"]["score"], r["activity"]["score"]), (100, 100))
        self.assertEqual((r["recovery"]["state"], r["recovery"]["steady"], r["recovery"]["days"]), ("steady", 7, 7))
        self.assertEqual(r["load"]["state"], "steady")
        self.assertEqual(r["headline"], "恢复平稳、睡眠不错、活动量充足、训练节奏平稳。各项都在合适的范围内，保持就好。")
        self.assertEqual((r["start"], r["end"], r["sunday"], r["partial"]), (7, 13, True, False))
        self.assertEqual((r["sleep"]["nights"], r["sleep"]["bed"], r["sleep"]["wake"]), (7, -30, 430))

    def test_an_area_with_a_suggestion_is_not_also_praised(self):
        r = Week().set(sleep7=6.8, sri7=88.0).last()                  # sleep score 84, but under 7 hours
        self.assertGreaterEqual(r["sleep"]["score"], 80)
        self.assertEqual([t["id"] for t in r["tips"]], ["sleep_below"])
        self.assertNotIn("睡眠不错", r["headline"])
        self.assertTrue(r["headline"].startswith("恢复平稳、活动量充足、训练节奏平稳。"))
        r = Week().set(strengthDays7=1).last()                        # activity score 90, one strength day
        self.assertNotIn("活动量充足", r["headline"])

    def test_a_week_without_any_data_gets_no_report(self):
        reports = Week().reports()
        self.assertEqual([r["end"] for r in reports], [13])          # the first week is empty

    def test_the_export_day_is_marked(self):
        self.assertTrue(Week().reports(partial_day=DAYS[-1])[-1]["partial"])

    def test_steps_alone_do_not_make_a_good_week(self):
        w = Week()
        for key in KEYS:
            if key != "steps7":
                w.A[key] = [None] * N
        w.daily = {k: [None] * N for k in w.daily}
        r = w.last()
        self.assertEqual((r["activity"]["score"], r["activity"]["partial"]), (100, True))
        self.assertEqual(r["headline"], "这 7 天的记录不多，只能看到一部分情况。")

    def test_a_large_debt_alone_is_only_context(self):
        w = Week().set(sleepDebt14=11.0, sleep7=7.2)
        self.assertEqual(w.tip_ids(), [])
        self.assertEqual(w.last()["sleep"]["debt"], 11.0)


class Recovery(unittest.TestCase):
    def test_low_hrv_needs_three_days_in_a_row(self):
        w = Week()
        w.A["hrvZ"][12], w.A["hrvZ"][13] = -0.8, -0.9
        r = w.last()
        self.assertEqual((r["recovery"]["state"], r["recovery"]["lowRun"], r["recovery"]["steady"]), ("mixed", 2, 5))
        self.assertNotIn("hrv_low", [t["id"] for t in r["tips"]])
        w.A["hrvZ"][11] = -0.6
        r = w.last()
        self.assertEqual((r["recovery"]["state"], r["recovery"]["lowRun"]), ("low", 3))
        tip = next(t for t in r["tips"] if t["id"] == "hrv_low")
        self.assertIn("连续 3 天", tip["text"])
        self.assertEqual(tip["basis"], ["hrv_night"])

    def test_a_gap_in_the_data_ends_the_run(self):
        w = Week()
        w.A["hrvZ"][10], w.A["hrvZ"][11], w.A["hrvZ"][12], w.A["hrvZ"][13] = -0.9, None, -0.9, -0.9
        self.assertEqual(w.last()["recovery"]["lowRun"], 2)

    def test_one_night_with_two_signals_off(self):
        w = Week()
        w.A["vitalsOut"][9] = 2
        w.A["zSleepHr"][9], w.A["zResp"][9], w.A["zSleepHrv"][9] = 3.1, 2.4, 0.5
        r = w.last()
        tip = r["tips"][0]
        self.assertEqual((tip["id"], tip["level"]), ("vitals", 2))
        self.assertIn("3 月 5 日（周三）", tip["text"])
        self.assertIn("睡眠心率偏高、呼吸偏快", tip["text"])
        self.assertNotIn("HRV", tip["text"])                          # a higher HRV is not a deviation to report
        self.assertEqual(r["recovery"]["nights"], [{"d": 9, "signals": [["sleepHr", 3.1], ["resp", 2.4]]}])
        self.assertEqual((r["recovery"]["state"], r["recovery"]["steady"]), ("mixed", 6))
        self.assertTrue(r["headline"].endswith("这周最值得留意的是那一晚的身体信号。"))

    def test_two_such_nights_come_first_and_count_as_low(self):
        w = Week().set(steps7=3000)
        for j in (9, 12):
            w.A["vitalsOut"][j], w.A["zSleepSpo2"][j], w.A["zWristTemp"][j] = 2, -2.5, 2.2
        r = w.last()
        self.assertEqual([(t["id"], t["level"]) for t in r["tips"]], [("vitals", 3), ("steps_low", 2)])
        self.assertEqual(r["recovery"]["state"], "low")
        self.assertIn("血氧偏低", r["tips"][0]["text"])

    def test_resting_heart_rate_above_its_usual_range(self):
        w = Week().set(rhr7=66.2, rhrZ=2.4)
        w.A["rhrZ"][13] = 2.4
        r = w.last()
        self.assertEqual(r["recovery"]["state"], "low")
        self.assertIn("高出 6.2", next(t for t in r["tips"] if t["id"] == "rhr_high")["text"])

    def test_too_few_days_to_judge(self):
        w = Week()
        for j in range(7, 11):
            for key in ("hrvZ", "rhrZ", "vitalsOut"):
                w.A[key][j] = None
        r = w.last()
        self.assertEqual((r["recovery"]["state"], r["recovery"]["days"]), ("none", 3))
        self.assertNotIn("恢复平稳", r["headline"])


class Sleep(unittest.TestCase):
    def test_short_week(self):
        w = Week().set(sleep7=6.2, shortNights7=2)
        tip = next(t for t in w.last()["tips"] if t["id"] == "sleep_short")
        self.assertIn("平均每晚睡 6 小时 12 分，其中 2 晚不足 6 小时", tip["text"])
        self.assertTrue(tip["text"].startswith("手表记录到"))

    def test_three_short_nights_count_even_when_the_average_is_fine(self):
        self.assertIn("sleep_short", Week().set(sleep7=7.2, shortNights7=3).tip_ids())

    def test_slightly_under_seven_hours_is_a_small_note(self):
        tips = Week().set(sleep7=6.8).last()["tips"]
        self.assertEqual([(t["id"], t["level"]) for t in tips], [("sleep_below", 1)])

    def test_irregular_by_either_measure(self):
        self.assertIn("sleep_irregular", Week().set(sri28=68.0).tip_ids())
        self.assertIn("sleep_irregular", Week().set(bedSd7=95).tip_ids())
        self.assertNotIn("sleep_irregular", Week().set(sri28=75.0, bedSd7=60).tip_ids())
        text = Week().set(sri28=68.0, bedSd7=95).last()["tips"][0]["text"]
        self.assertIn("95 分钟", text)
        self.assertIn("68", text)

    def test_nights_with_a_cut_record_are_set_aside(self):
        w = Week().set(sleep7=6.0, shortNights7=1)
        w.daily["sleepCut"][10] = 1
        r = w.last()
        self.assertEqual((r["sleep"]["nights"], r["sleep"]["cut"]), (6, 1))
        self.assertIn("另有 1 晚的记录可能不完整", next(t for t in r["tips"] if t["id"] == "sleep_short")["text"])

    def test_score_uses_the_four_week_index_when_the_week_has_too_few_pairs(self):
        w = Week().set(sri7=None, sri28=71.6)
        self.assertEqual(w.last()["sleep"]["score"], 60 + 20)


class ActivityAndTraining(unittest.TestCase):
    def test_few_steps_and_little_exercise(self):
        w = Week().set(steps7=4200, exercise7=90)
        r = w.last()
        self.assertEqual([t["id"] for t in r["tips"]], ["steps_low", "activity_low"])
        self.assertIn("4,200 步", r["tips"][0]["text"])
        self.assertEqual(r["activity"]["score"], round(40 * (0.5 * 2200 / 3000) + 40 * 90 / 150 + 20))

    def test_load_states(self):
        for ratio, state in ((0.4, "far_below"), (0.7, "below"), (0.8, "steady"), (1.3, "steady"),
                             (1.4, "above"), (1.5, "above"), (1.6, "far_above")):
            self.assertEqual(Week().set(loadRatio=ratio).last()["load"]["state"], state, ratio)
        self.assertEqual(Week().set(loadRatio=None, load7=0, loadBase=0).last()["load"]["state"], "rest")
        self.assertEqual(Week().set(loadRatio=None, load7=900, loadBase=60).last()["load"]["state"], "restart")
        self.assertEqual(Week().set(loadRatio=None, load7=900, loadBase=None).last()["load"]["state"], "new")
        self.assertEqual(Week().set(loadRatio=None, load7=None, loadBase=None).last()["load"]["state"], "none")

    def test_fast_increase_and_restart(self):
        self.assertIn("1.8 倍", next(t for t in Week().set(loadRatio=1.8).last()["tips"] if t["id"] == "load_up")["text"])
        tips = Week().set(loadRatio=None, load7=900, loadBase=60).last()["tips"]
        self.assertEqual([(t["id"], t["level"]) for t in tips], [("load_restart", 1)])
        # many times the earlier load means the earlier weeks were nearly empty: a restart, not a spike
        self.assertEqual(Week().set(loadRatio=7.2).tip_ids(), ["load_restart"])
        self.assertEqual(Week().set(loadRatio=3.0).tip_ids(), ["load_up"])

    def test_gap_and_strength_notes(self):
        self.assertEqual(Week().set(daysSinceWorkout=12, strengthDays7=0, loadRatio=None, load7=0, loadBase=800).tip_ids(),
                         ["training_gap"])                           # not also nagged about strength
        self.assertEqual(Week().set(strengthDays7=1).tip_ids(), ["strength_low"])
        never = Week().set(strengthDays7=None, daysSinceWorkout=None, loadRatio=None, load7=None, loadBase=None)
        self.assertEqual(never.tip_ids(), [])                        # no workout records at all: nothing to say

    def test_workouts_in_the_week_are_counted(self):
        w = Week()
        w.workouts = [{"d": 6, "min": 50}, {"d": 8, "min": 60.4}, {"d": 13, "min": 30}]
        self.assertEqual((w.last()["load"]["sessions"], w.last()["load"]["minutes"]), (2, 90))


class WholeHistory(unittest.TestCase):
    def reports(self, days, daily, kind, segs, workouts):
        from hk.analysis import build_analysis
        A = build_analysis(days=days, daily=daily, sleep_kind=kind, sleep_segments=segs, workouts=workouts,
                           params=PARAMS, sleep_need=8.0)["daily"]
        return R.build_reports(days=days, daily=daily, analysis=A, workouts=workouts, params=PARAMS, scores=SCORES)

    def test_an_old_report_reads_the_same_whenever_it_is_built(self):
        from test_analysis import made_up_data
        _labels, daily, kind, segs, workouts = made_up_data(n=150)
        days = [(date(2025, 1, 6) + timedelta(days=k)).isoformat() for k in range(150)]   # starts on a Monday
        full = {r["end"]: r for r in self.reports(days, daily, kind, segs, workouts)}
        self.assertGreater(len(full), 15)
        for cut in (70, 101, 133):
            part = self.reports(days[:cut], {k: v[:cut] for k, v in daily.items()}, kind[:cut],
                                [s for s in segs if s[0] < cut], [w for w in workouts if w["d"] < cut])
            sundays = [r for r in part if r["sunday"]]
            self.assertTrue(sundays)
            for r in sundays:
                self.assertEqual(r, full[r["end"]])


class Wording(unittest.TestCase):
    def test_no_alarm_words_anywhere(self):
        w = Week().set(sleep7=5.5, shortNights7=4, sri28=60.0, bedSd7=120, steps7=2500, exercise7=40,
                       loadRatio=2.2, rhr7=67.0, rhrZ=2.6, strengthDays7=0)
        for j in LAST:
            w.A["hrvZ"][j] = -1.2
        w.A["rhrZ"][13] = 2.6
        for j in (9, 12):
            w.A["vitalsOut"][j], w.A["zSleepHr"][j], w.A["zResp"][j] = 2, 3.0, 2.5
        r = w.last()
        self.assertGreaterEqual(len(r["tips"]), 7)
        text = r["headline"] + "".join(t["title"] + t["text"] for t in r["tips"])
        for word in ("警告", "危险", "异常", "严重", "必须", "立即", "！"):
            self.assertNotIn(word, text)
        self.assertEqual([t["level"] for t in r["tips"]], sorted((t["level"] for t in r["tips"]), reverse=True))
        indicator_ids = set(PARAMS)
        for t in r["tips"]:
            self.assertTrue(t["basis"] and set(t["basis"]) <= indicator_ids, t["id"])


if __name__ == "__main__":
    unittest.main()
