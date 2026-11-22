"""Typical error and the weekly rhythm, on made-up readings."""
import math
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))

from hk import noise as NZ                                          # noqa: E402
from hk.reference import load_reference, params_by_id               # noqa: E402

P = params_by_id(load_reference())["noise_band"]
DAYS = [(date(2025, 3, 3) + timedelta(days=k)).isoformat() for k in range(120)]   # starts on a Monday


class TypicalError(unittest.TestCase):
    def test_alternating_readings(self):
        values = [60.0, 62.0] * 30                                  # every difference is +2 or -2
        te, pairs = NZ.typical_error(values, 59, history_days=365, min_pairs=20, max_gap=1)
        self.assertEqual(pairs, 59)
        sd = math.sqrt(sum((d - 2 / 59) ** 2 for d in [2, -2] * 29 + [2]) / 58)
        self.assertAlmostEqual(te, sd / math.sqrt(2))

    def test_a_steady_trend_is_not_noise(self):
        values = [70 + 0.1 * k for k in range(60)]                  # rises by exactly 0.1 a day
        te, _pairs = NZ.typical_error(values, 59, history_days=365, min_pairs=20, max_gap=1)
        self.assertAlmostEqual(te, 0, places=9)

    def test_only_readings_close_together_are_paired(self):
        values = [None] * 60
        for k in range(0, 60, 3):                                   # every third day
            values[k] = 70.0 + (k % 2)
        self.assertEqual(NZ.typical_error(values, 59, history_days=365, min_pairs=5, max_gap=2), (None, 0))
        te, pairs = NZ.typical_error(values, 59, history_days=365, min_pairs=5, max_gap=3)
        self.assertEqual(pairs, 19)
        self.assertGreater(te, 0)

    def test_only_the_history_window_counts(self):
        values = [50.0, 80.0] * 50 + [60.0, 61.0] * 10
        te, pairs = NZ.typical_error(values, 119, history_days=20, min_pairs=10, max_gap=1)
        self.assertEqual(pairs, 19)
        self.assertLess(te, 1)


class Table(unittest.TestCase):
    def test_every_reading_with_enough_pairs_and_not_the_bookkeeping(self):
        daily = {"rhr": [60.0 + (k % 3) for k in range(120)], "wear": [80] * 120, "sleepCut": [0] * 120,
                 "weight": [None] * 120, "steps": [None] * 119 + [5000]}
        out = NZ.noise_table(DAYS, daily, P)
        self.assertEqual(set(out["keys"]), {"rhr"})
        self.assertEqual(out["keys"]["rhr"][1], 119)
        self.assertEqual(out["z"], P["z"])

    def test_a_published_figure_stands_in_when_readings_are_too_few(self):
        vo2 = [None] * 120
        vo2[10], vo2[60] = 45.0, 46.0
        out = NZ.noise_table(DAYS, {"vo2max": vo2}, P)
        self.assertEqual(out["keys"]["vo2max"], [P["fallback_te"]["vo2max"], 0])
        self.assertNotIn("vo2max", NZ.noise_table(DAYS, {"vo2max": [None] * 120}, P)["keys"])

    def test_weight_rhythm_after_the_weekend(self):
        weight = [70 + (0.4 if date.fromisoformat(d).weekday() == 0 else 0) for d in DAYS]   # Mondays heavier
        out = NZ.noise_table(DAYS, {"weight": weight}, P)
        rows = out["weekday"]["weight"]
        self.assertEqual(len(rows), 7)
        self.assertAlmostEqual(rows[0][0], 0.4)                     # Monday stands out from the days around it
        self.assertLess(rows[3][0], 0)
        self.assertEqual(rows[0][2], 18)


if __name__ == "__main__":
    unittest.main()
