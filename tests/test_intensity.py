"""Activity intensity from made-up PhysicalEffort samples: moderate and vigorous minutes, bursts."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))

from hk.intensity import intensity_daily                            # noqa: E402
from hk.parse import parse_ts                                       # noqa: E402
from hk.tz import DAY, Timeline                                     # noqa: E402

T0 = parse_ts("2025-03-03 00:00:00 +0800")                          # a Monday, local midnight
TL = Timeline([[T0 - DAY, "UTC+08:00", "default"]], T0 + 30 * DAY, 8 * 3600)
DAY0 = TL.local_day(T0)
M = 60
WATCH, PHONE = 0, 1
RANK = {WATCH: 0, PHONE: 1}


def worn_day(day=0, extra=()):
    """A day covered end to end at 1 MET by the watch, with ``extra`` (start min, end min, METs) on top."""
    base = T0 + day * DAY
    recs, t = [], 0
    marks = sorted(extra)
    for a, b, v in marks:
        if a > t:
            recs.append((base + t * M, base + a * M, 1.0, WATCH))
        recs.append((base + a * M, base + b * M, v, WATCH))
        t = b
    if t < 1440:
        recs.append((base + t * M, base + 1440 * M, 1.0, WATCH))
    return recs


def run(records, ndays=3, **kw):
    args = dict(moderate=3, vigorous=6, burst=(1, 3), gap=60, min_cover=0.4)
    args.update(kw)
    return intensity_daily(records, TL, DAY0, ndays, RANK, **args)


class Minutes(unittest.TestCase):
    def test_effort_is_split_into_moderate_and_vigorous_minutes(self):
        out = run(worn_day(0, [(480, 510, 4.0), (600, 620, 7.5), (700, 701, 2.9)]))
        self.assertEqual(out["modMin"][0], 30)
        self.assertEqual(out["vigMin"][0], 20)
        self.assertEqual(out["effortCover"][0], 1440)
        self.assertIsNone(out["modMin"][1])                         # nothing recorded that day

    def test_a_sample_across_midnight_is_split_by_duration(self):
        recs = worn_day(0, [(1430, 1440, 4.0)]) + worn_day(1, [(0, 20, 4.0)])
        out = run(recs)
        self.assertEqual((out["modMin"][0], out["modMin"][1]), (10, 20))
        crossing = [(T0, T0 + 1420 * M, 1.0, WATCH), (T0 + 1420 * M, T0 + 1460 * M, 4.0, WATCH),
                    (T0 + 1460 * M, T0 + 2 * DAY, 1.0, WATCH)]
        out = run(crossing)
        self.assertEqual((out["modMin"][0], out["modMin"][1]), (20, 20))

    def test_a_day_the_watch_was_hardly_worn_is_unknown_not_quiet(self):
        recs = [(T0 + 480 * M, T0 + 540 * M, 4.0, WATCH), (T0 + 540 * M, T0 + 900 * M, 1.0, WATCH)]  # 7 hours
        out = run(recs)
        self.assertEqual(out["effortCover"][0], 420)
        self.assertIsNone(out["modMin"][0])
        self.assertIsNone(out["vigBursts"][0])

    def test_a_lower_ranked_source_does_not_count_twice(self):
        recs = worn_day(0, [(480, 510, 4.0)]) + [(T0 + 480 * M, T0 + 510 * M, 4.0, PHONE)]
        self.assertEqual(run(recs)["modMin"][0], 30)


class Bursts(unittest.TestCase):
    def test_short_vigorous_stretches_outside_workouts(self):
        out = run(worn_day(0, [(300, 301.5, 7.0), (400, 402, 8.0), (500, 500.5, 7.0), (600, 610, 7.0)]))
        self.assertEqual(out["vigBursts"][0], 2)                    # 30 s is too short, 10 min too long

    def test_pieces_close_together_join_into_one(self):
        out = run(worn_day(0, [(300, 300.8, 7.0), (300.8, 301.2, 5.0), (301.2, 302, 7.0)]))
        self.assertEqual(out["vigBursts"][0], 1)                    # a 24 s dip does not split it
        out = run(worn_day(0, [(300, 300.8, 7.0), (300.8, 303, 5.0), (303, 303.9, 7.0)]))
        self.assertEqual(out["vigBursts"][0], 0)                    # two short pieces, apart: neither is a minute

    def test_bursts_inside_a_workout_are_exercise_not_daily_life(self):
        recs = worn_day(0, [(300, 302, 7.0), (400, 402, 7.0)])
        out = run(recs, workouts=[(T0 + 390 * M, T0 + 450 * M)])
        self.assertEqual(out["vigBursts"][0], 1)


if __name__ == "__main__":
    unittest.main()
