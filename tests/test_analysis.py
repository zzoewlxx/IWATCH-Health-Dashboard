"""The analysis layer, exercised on made-up data only.

Run from the repository root:  python -m unittest discover -s tests
"""
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))

from hk import analysis as A                                    # noqa: E402
from hk.reference import load_reference, params_by_id           # noqa: E402

PARAMS = params_by_id(load_reference())
BASE = dict(recent_days=7, min_recent=4, baseline_days=60, min_baseline=20, min_sd=0.5)


def night(day: int, start: int, end: int, code: int = 1) -> list:
    """One night's segment list for wake-up day ``day``; minutes are relative to that day's midnight."""
    return [day, [[start, end, code]]]


class RecentVsBaseline(unittest.TestCase):
    def test_shift_is_measured_in_baseline_standard_deviations(self):
        values = [10, 12] * 30 + [13] * 7                       # 60 baseline days, then a week at 13
        recent, base, sd, z = A.recent_vs_baseline(values, **BASE)
        self.assertAlmostEqual(recent[-1], 13)
        self.assertAlmostEqual(base[-1], 11)
        self.assertAlmostEqual(sd[-1], (60 / 59) ** 0.5)        # sample SD of thirty 10s and thirty 12s
        self.assertAlmostEqual(z[-1], 2 / (60 / 59) ** 0.5)

    def test_baseline_never_includes_the_recent_days(self):
        values = [50] * 60 + [80] * 7
        _recent, base, _sd, _z = A.recent_vs_baseline(values, **BASE)
        self.assertEqual(base[-1], 50)

    def test_too_little_data_gives_nothing(self):
        values = [50.0] * 25
        recent, base, _sd, z = A.recent_vs_baseline(values, **BASE)
        self.assertEqual(recent[24], 50)                         # a week of readings is enough for the recent mean
        self.assertIsNone(base[24])                              # ...but only 18 days sit before it
        self.assertIsNone(z[24])
        sparse = [None] * 67
        sparse[-2:] = [50.0, 51.0]
        self.assertIsNone(A.recent_vs_baseline(sparse, **BASE)[0][-1])

    def test_flat_baseline_uses_the_minimum_spread(self):
        values = [60] * 60 + [61] * 7
        _recent, _base, sd, z = A.recent_vs_baseline(values, **BASE)
        self.assertEqual(sd[-1], 0.5)
        self.assertAlmostEqual(z[-1], 2.0)

    def test_log_statistics_give_geometric_means(self):
        values = [10, 1000] * 30 + [100] * 7
        recent, base, _sd, z = A.recent_vs_baseline(values, **BASE, log=True)
        self.assertAlmostEqual(A._exp(base[-1]), 100)
        self.assertAlmostEqual(A._exp(recent[-1]), 100)
        self.assertAlmostEqual(z[-1], 0)

    def test_later_days_do_not_change_earlier_results(self):
        rng = random.Random(1)
        values = [50 + rng.gauss(0, 4) for _ in range(120)]
        before = A.recent_vs_baseline(values, **BASE)
        changed = values[:100] + [999.0] * 20
        after = A.recent_vs_baseline(changed, **BASE)
        for x, y in zip(before, after):
            self.assertEqual(x[:100], y[:100])


class NightOutliers(unittest.TestCase):
    def setUp(self):
        self.p = PARAMS["night_vitals"]
        self.n = 41
        wobble = [0, 1, -1, 0, 1, -1, 0, 1]
        self.daily = {
            "sleepHr": [58 + wobble[i % 8] for i in range(self.n)],
            "sleepHrv": [50 + 3 * wobble[i % 8] for i in range(self.n)],
            "resp": [14 + 0.2 * wobble[i % 8] for i in range(self.n)],
            "wristTemp": [35.6 + 0.1 * wobble[i % 8] for i in range(self.n)],
            "sleepSpo2": [96.5 + 0.5 * wobble[i % 8] for i in range(self.n)],
        }

    def test_an_ordinary_night_has_no_outliers(self):
        _z, evaluable, outliers = A.night_outliers(self.daily, self.n, self.p)
        self.assertEqual(evaluable[-1], 5)
        self.assertEqual(outliers[-1], 0)

    def test_two_signals_off_in_the_unfavourable_direction(self):
        self.daily["sleepHr"][-1] = 70
        self.daily["resp"][-1] = 16.5
        z, _evaluable, outliers = A.night_outliers(self.daily, self.n, self.p)
        self.assertEqual(outliers[-1], 2)
        self.assertGreater(z["sleepHr"][-1], 2)

    def test_only_the_unfavourable_direction_counts(self):
        self.daily["sleepHr"][-1] = 46                           # lower heart rate
        self.daily["sleepHrv"][-1] = 95                          # higher HRV
        self.daily["sleepSpo2"][-1] = 99.5                       # higher oxygen
        z, _evaluable, outliers = A.night_outliers(self.daily, self.n, self.p)
        self.assertLess(z["sleepHr"][-1], -2)
        self.assertEqual(outliers[-1], 0)
        self.daily["sleepHrv"][-1] = 25                          # a low HRV does count
        self.assertEqual(A.night_outliers(self.daily, self.n, self.p)[2][-1], 1)

    def test_needs_enough_signals_and_enough_history(self):
        for key in ("resp", "wristTemp", "sleepSpo2"):
            self.daily[key] = [None] * self.n
        _z, evaluable, outliers = A.night_outliers(self.daily, self.n, self.p)
        self.assertIsNone(evaluable[-1])
        self.assertIsNone(outliers[-1])
        self.assertIsNone(A.night_outliers(self.daily, self.n, self.p)[0]["sleepHr"][5])


class NightHeartRateRuns(unittest.TestCase):
    """The NightSignal-style rule: sleeping heart rate a few beats above the usual, nights in a row."""
    P = dict(baseline_nights=90, min_baseline=14, rise_bpm=4, max_gap_nights=1)

    def nights(self, tail):
        return [58.0, 59.0] * 10 + tail                          # twenty ordinary nights, median 58.5

    def test_baseline_is_the_median_of_earlier_nights_only(self):
        base, rise, run = A.night_hr_runs(self.nights([70.0]), **self.P)
        self.assertEqual(base[20], 58.5)                         # the high night itself is not in it
        self.assertEqual(rise[20], 11.5)
        self.assertEqual(run[20], 1)
        self.assertEqual(run[19], 0)
        self.assertIsNone(run[5])                                # fewer than 14 earlier nights: no judgement

    def test_counts_nights_in_a_row_at_or_above_the_line(self):
        _base, _rise, run = A.night_hr_runs(self.nights([62.5, 63.0, 62.4, 64.0]), **self.P)
        self.assertEqual(run[20:], [1, 2, 0, 1])                 # 62.4 is only 3.4 above: the run ends

    def test_one_missing_night_does_not_break_a_run_but_two_do(self):
        _base, _rise, run = A.night_hr_runs(self.nights([63.0, None, 63.0]), **self.P)
        self.assertEqual(run[20:], [1, None, 2])
        _base, _rise, run = A.night_hr_runs(self.nights([63.0, None, None, 63.0]), **self.P)
        self.assertEqual(run[20:], [1, None, None, 1])

    def test_baseline_window_follows_slow_change(self):
        values = [50.0] * 100 + [60.0] * 100 + [61.0]
        base, _rise, run = A.night_hr_runs(values, **self.P)
        self.assertEqual(base[-1], 60.0)                         # only the last 90 nights count
        self.assertEqual(run[-1], 0)

    def test_episodes_list_each_run_once_with_its_nights(self):
        base, rise, run = A.night_hr_runs(self.nights([63.0, 64.0, 58.0, 66.0, None, 63.0, 63.5]), **self.P)
        eps = A.hr_episodes(run, rise, base, min_nights=2, max_gap_nights=1)
        self.assertEqual([(e["start"], e["end"], e["nights"]) for e in eps], [(20, 21, 2), (23, 26, 3)])
        self.assertEqual(eps[1]["members"], [23, 25, 26])
        self.assertEqual(eps[1]["rise"], 7.0)
        self.assertTrue(eps[1]["ongoing"])
        self.assertFalse(eps[0]["ongoing"])
        # as known on day 25 the second run had two nights; on day 22 the first was already over
        self.assertEqual([e["nights"] for e in A.hr_episodes(run, rise, base, min_nights=2, max_gap_nights=1, upto=25)],
                         [2, 2])
        self.assertEqual(A.hr_episodes(run, rise, base, min_nights=2, max_gap_nights=1, upto=22)[0]["ongoing"], False)


class Intensity(unittest.TestCase):
    def build(self, mod, vig, bursts=None):
        n = len(mod)
        days, daily, kind, segs, workouts = made_up_data(n=n)
        daily.update(modMin=mod, vigMin=vig, vigBursts=bursts or [0] * n)
        return A.build_analysis(days=days, daily=daily, sleep_kind=kind, sleep_segments=segs, workouts=workouts,
                                params=PARAMS, sleep_need=8.0)["daily"]

    def test_a_vigorous_minute_counts_twice(self):
        out = self.build([20] * 14, [5] * 14)
        self.assertEqual(out["mvpa7"][13], 7 * (20 + 2 * 5))
        self.assertEqual((out["mod7"][13], out["vig7"][13]), (140, 35))

    def test_days_without_data_are_filled_with_the_average_of_the_rest(self):
        mod = [20] * 12 + [None, None]
        out = self.build(mod, [0] * 12 + [None, None])
        self.assertEqual(out["mvpa7"][13], 140)                  # five days of 20, scaled to seven
        out = self.build([20] * 10 + [None] * 4, [0] * 10 + [None] * 4)
        self.assertIsNone(out["mvpa7"][13])                      # only three days: too few

    def test_share_of_the_two_busiest_days(self):
        out = self.build([10, 10, 10, 10, 10, 100, 100] * 2, [0] * 14)
        self.assertEqual(out["topShare7"][13], round(200 / 250, 2))


class SleepRegularity(unittest.TestCase):
    def test_identical_nights_score_100(self):
        n = 10
        segs = [night(d, -60, 420) for d in range(n)]            # 23:00 -> 07:00 every night
        sri = A.sleep_regularity(n, ["stages"] * n, segs, pairs=7, min_pairs=5)
        self.assertEqual(sri[-1], 100)
        self.assertIsNone(sri[3])                                # only three pairs so far

    def test_two_hour_shift_every_other_night(self):
        n = 12
        segs = [night(d, -60, 420) if d % 2 == 0 else night(d, 60, 540) for d in range(n)]
        sri = A.sleep_regularity(n, ["stages"] * n, segs, pairs=7, min_pairs=5)
        self.assertAlmostEqual(sri[-1], -100 + 200 * (1440 - 240) / 1440)   # 4 of 24 hours differ

    def test_opposite_schedules_score_below_zero(self):
        n = 10
        segs = [night(d, -60, 420) if d % 2 == 0 else night(d, 480, 960) for d in range(n)]
        sri = A.sleep_regularity(n, ["stages"] * n, segs, pairs=7, min_pairs=5)
        self.assertAlmostEqual(sri[-1], -100 + 200 * (1440 - 960) / 1440)

    def test_nights_without_measured_sleep_are_skipped_not_counted_as_awake(self):
        n = 10
        segs = [night(d, -60, 420) for d in range(n) if d != 6]
        kind = ["stages"] * n
        kind[6] = None                                           # watch not worn
        self.assertIsNone(A.sleep_regularity(n, kind, segs, pairs=7, min_pairs=6)[-1])   # 5 valid pairs
        self.assertEqual(A.sleep_regularity(n, kind, segs, pairs=7, min_pairs=5)[-1], 100)

    def test_in_bed_guesses_and_awake_time_are_not_sleep(self):
        n = 8
        segs = [[d, [[-90, -60, 5], [-60, 180, 1], [180, 200, 4], [200, 420, 2]]] for d in range(n)]
        sri = A.sleep_regularity(n, ["stages"] * n, segs, pairs=7, min_pairs=5)
        self.assertEqual(sri[-1], 100)
        kind = ["inbed"] * n                                     # phone-only estimate: not measured
        self.assertIsNone(A.sleep_regularity(n, kind, segs, pairs=7, min_pairs=5)[-1])


class SleepSeries(unittest.TestCase):
    def series(self, total, bed=None, need=8.0):
        n = len(total)
        daily = {"sleepTotal": total, "bedtime": bed or [-30 if v is not None else None for v in total]}
        kind = ["stages" if v is not None else None for v in total]
        segs = [night(d, -30, -30 + int(v * 60)) for d, v in enumerate(total) if v is not None]
        return A.sleep_series(daily, kind, segs, need, PARAMS), n

    def test_debt_adds_up_over_two_weeks(self):
        out, _n = self.series([7.0] * 14)
        self.assertEqual(out["sleepDebt14"][-1], 14.0)           # an hour short for 14 nights
        self.assertIsNone(out["sleepDebt14"][8])                 # nine nights so far

    def test_long_nights_offset_short_ones(self):
        out, _n = self.series([6.0, 10.0] * 7)
        self.assertEqual(out["sleepDebt14"][-1], 0)

    def test_sleep_need_is_a_setting(self):
        out, _n = self.series([7.0] * 14, need=7.0)
        self.assertEqual(out["sleepDebt14"][-1], 0)

    def test_week_average_and_short_nights(self):
        out, _n = self.series([8.0, 5.5, 8.0, 5.0, 8.0, 8.0, 7.5])
        self.assertAlmostEqual(out["sleep7"][-1], 50 / 7, places=2)
        self.assertEqual(out["shortNights7"][-1], 2)
        self.assertIsNone(out["sleep7"][2])

    def test_missing_nights_are_left_out(self):
        out, _n = self.series([8.0, None, None, 6.0, 7.0, None, 7.0])
        self.assertAlmostEqual(out["sleep7"][-1], 7.0)
        self.assertEqual(out["shortNights7"][-1], 0)

    def test_timing_spread(self):
        bed = [-60, 60] * 4                                      # 23:00 and 01:00 alternating
        out, _n = self.series([8.0] * 8, bed=bed)
        expected = (sum((x - sum(bed[1:]) / 7) ** 2 for x in bed[1:]) / 6) ** 0.5
        self.assertEqual(out["bedSd7"][-1], round(expected))
        self.assertEqual(out["durSd7"][-1], 0)

    def test_length_spread_is_taken_on_the_whole_day_of_sleep(self):
        # sleepTotal already includes naps, so a night stored as "4 h + a 4 h nap" (a long
        # waking spell in the middle) counts as eight hours here, not as a four-hour night
        out, _n = self.series([7.0, 9.0] * 4)
        last_week = [9, 7, 9, 7, 9, 7, 9]
        expected = (sum((x - sum(last_week) / 7) ** 2 for x in last_week) / 6) ** 0.5 * 60
        self.assertEqual(out["durSd7"][-1], round(expected))


class Training(unittest.TestCase):
    def w(self, d, key="TraditionalStrengthTraining", minutes=60, effort=None):
        return {"d": d, "key": key, "min": minutes, "effort": effort}

    def test_missing_effort_borrows_from_earlier_workouts(self):
        ws = [self.w(0), self.w(1, effort=8), self.w(2, effort=6), self.w(3),
              self.w(4, key="Running", minutes=30), self.w(5, key="Running", minutes=30, effort=4),
              self.w(6, key="Running", minutes=30)]
        loads = A.workout_loads(ws, default_effort=5)
        self.assertEqual(loads[0], (300, True))                  # nothing to go on: default 5
        self.assertEqual(loads[1], (480, False))
        self.assertEqual(loads[3], (420, True))                  # median of 8 and 6
        self.assertEqual(loads[4], (210, True))                  # no earlier run: median of all ratings
        self.assertEqual(loads[6], (120, True))                  # earlier run rated 4

    def test_ratio_compares_the_week_with_the_four_weeks_before(self):
        n = 42
        ws = [self.w(d, effort=5) for d in range(0, 35, 2)] + [self.w(d, effort=5) for d in range(35, 42)]
        loads = A.workout_loads(ws, 5)
        out = A.training_series(n, ws, loads, PARAMS)
        self.assertEqual(out["load7"][-1], 7 * 300)
        self.assertEqual(out["loadBase"][-1], 14 * 300 / 4)      # 14 sessions in days 7..34
        self.assertEqual(out["loadRatio"][-1], 2.0)
        self.assertIsNone(out["loadBase"][33])                   # needs 35 days on record
        self.assertEqual(out["load7"][6], 4 * 300)

    def test_no_ratio_after_a_long_break(self):
        n = 60
        ws = [self.w(0, effort=5)] + [self.w(d, effort=7) for d in (57, 58, 59)]
        out = A.training_series(n, ws, A.workout_loads(ws, 5), PARAMS)
        self.assertEqual(out["loadBase"][-1], 0)
        self.assertIsNone(out["loadRatio"][-1])
        self.assertEqual(out["daysSinceWorkout"][56], 56)
        self.assertEqual(out["daysSinceWorkout"][-1], 0)

    def test_nothing_before_the_first_recorded_workout(self):
        ws = [self.w(10, effort=5)]
        out = A.training_series(20, ws, A.workout_loads(ws, 5), PARAMS)
        self.assertIsNone(out["load"][9])
        self.assertIsNone(out["daysSinceWorkout"][9])
        self.assertEqual(out["load"][10], 300)
        self.assertEqual(out["load"][11], 0)
        self.assertEqual(out["daysSinceWorkout"][13], 3)

    def test_strength_days_counts_days_not_sessions(self):
        ws = [self.w(3, effort=5), self.w(3, effort=5), self.w(5, key="CoreTraining", effort=5),
              self.w(6, key="Running", effort=5)]
        out = A.training_series(8, ws, A.workout_loads(ws, 5), PARAMS)
        self.assertEqual(out["strengthDays7"][7], 2)


def made_up_data(n=150, seed=7):
    rng = random.Random(seed)
    days = [f"day{i:03d}" for i in range(n)]
    gap = lambda v, p=0.1: None if rng.random() < p else v                  # noqa: E731
    total = [gap(round(7.4 + rng.gauss(0, 0.9), 2)) for _ in range(n)]
    bed = [None if t is None else int(rng.gauss(-20, 45)) for t in total]
    daily = {
        "sleepTotal": total,
        "bedtime": bed,
        "waketime": [None if t is None else b + int(t * 60) for t, b in zip(total, bed)],
        "sleepHrv": [None if t is None else round(55 + rng.gauss(0, 9), 1) for t in total],
        "sleepHr": [None if t is None else round(58 + rng.gauss(0, 2), 1) for t in total],
        "resp": [None if t is None else round(14 + rng.gauss(0, 0.3), 1) for t in total],
        "wristTemp": [None if t is None else gap(round(35.6 + rng.gauss(0, 0.2), 2), 0.4) for t in total],
        "sleepSpo2": [None if t is None else round(96.5 + rng.gauss(0, 0.8), 1) for t in total],
        "rhr": [gap(round(60 + rng.gauss(0, 2.5))) for _ in range(n)],
        "exerciseMin": [gap(int(abs(rng.gauss(40, 25)))) for _ in range(n)],
        "steps": [gap(int(abs(rng.gauss(6500, 2500)))) for _ in range(n)],
    }
    kind = ["stages" if t is not None else None for t in total]
    segs = [[d, [[bed[d], bed[d] + int(total[d] * 60), 1]]] for d in range(n) if total[d] is not None]
    workouts = []
    for d in range(20, n):
        if rng.random() < 0.45:
            key = rng.choice(["TraditionalStrengthTraining", "Running", "Walking"])
            workouts.append({"d": d, "key": key, "min": round(rng.uniform(20, 90), 1),
                             "effort": None if rng.random() < 0.3 else float(rng.randint(3, 9))})
    # intensity minutes from a second generator, so the series above stay exactly as they were
    r2 = random.Random(seed + 1000)
    worn = [r2.random() > 0.1 for _ in range(n)]
    daily["modMin"] = [round(abs(r2.gauss(30, 15)), 1) if w else None for w in worn]
    daily["vigMin"] = [round(abs(r2.gauss(5, 4)), 1) if w else None for w in worn]
    daily["vigBursts"] = [r2.randint(0, 4) if w else None for w in worn]
    return days, daily, kind, segs, workouts


class WholeBuild(unittest.TestCase):
    def build(self, days, daily, kind, segs, workouts):
        return A.build_analysis(days=days, daily=daily, sleep_kind=kind, sleep_segments=segs,
                                workouts=workouts, params=PARAMS, sleep_need=8.0)

    def test_every_series_is_described_and_full_length(self):
        days, daily, kind, segs, workouts = made_up_data()
        result = self.build(days, daily, kind, segs, workouts)
        info = A.series_info(PARAMS, 8.0)
        self.assertEqual(set(result["daily"]), set(info))
        for key, series in result["daily"].items():
            self.assertEqual(len(series), len(days), key)
            self.assertTrue(any(v is not None for v in series), key + " is empty")
        self.assertEqual(len(result["workoutLoad"]), len(workouts))
        self.assertEqual(result["params"]["sleepNeed"], 8.0)

    def test_a_past_day_reads_the_same_whenever_it_is_computed(self):
        days, daily, kind, segs, workouts = made_up_data()
        full = self.build(days, daily, kind, segs, workouts)
        for cut in (60, 95, 131):
            part = self.build(days[:cut], {k: v[:cut] for k, v in daily.items()}, kind[:cut],
                              [s for s in segs if s[0] < cut], [w for w in workouts if w["d"] < cut])
            for key, series in part["daily"].items():
                self.assertEqual(series, full["daily"][key][:cut], f"{key} changed when later days were added")
            self.assertEqual(part["workoutLoad"], full["workoutLoad"][:len(part["workoutLoad"])])

    def steady_month(self):
        n = 40
        days, daily, _kind, _segs, workouts = made_up_data(n=n)
        daily["sleepTotal"], daily["bedtime"] = [7.0] * n, [-30] * n
        daily["exerciseMin"] = [30] * n
        return days, daily, ["stages"] * n, [[d, [[-30, 390, 1]]] for d in range(n)], workouts

    def test_a_night_with_a_cut_record_counts_as_missing(self):
        days, daily, kind, segs, workouts = self.steady_month()
        daily["sleepTotal"][39], segs[39] = 2.0, [39, [[-30, 90, 1]]]      # the watch came off two hours in
        plain = self.build(days, daily, kind, segs, workouts)["daily"]
        self.assertEqual(plain["shortNights7"][39], 1)
        self.assertLess(plain["sri7"][39], 100)
        daily["sleepCut"] = [0] * 39 + [1]
        marked = self.build(days, daily, kind, segs, workouts)["daily"]
        self.assertEqual((marked["shortNights7"][39], marked["sleep7"][39]), (0, 7.0))
        self.assertEqual(marked["sleepDebt14"][39], 13.0)                  # thirteen nights, an hour short each
        self.assertEqual(marked["sri7"][39], 100)                          # the cut night is not compared

    def test_a_day_the_watch_was_hardly_worn_is_not_a_day_without_exercise(self):
        days, daily, kind, segs, workouts = self.steady_month()
        daily["exerciseMin"][39] = 0
        daily["wear"] = [80] * 39 + [20]
        self.assertEqual(self.build(days, daily, kind, segs, workouts)["daily"]["exercise7"][39], 210)
        daily["wear"][39] = 80                                             # worn all day: the zero is real
        self.assertEqual(self.build(days, daily, kind, segs, workouts)["daily"]["exercise7"][39], 180)

    def test_sleep_need_defaults_to_the_table(self):
        days, daily, kind, segs, workouts = made_up_data(n=40)
        result = A.build_analysis(days=days, daily=daily, sleep_kind=kind, sleep_segments=segs,
                                  workouts=workouts, params=PARAMS)
        self.assertEqual(result["params"]["sleepNeed"], PARAMS["sleep_debt"]["need_hours"])


if __name__ == "__main__":
    unittest.main()
