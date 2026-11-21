"""Which nights count as cut short (made-up nights)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))

from hk.sleep import truncated_nights                              # noqa: E402


class TruncatedNights(unittest.TestCase):
    def test_charging_after_a_normal_night_still_counts(self):
        total = [7.5] * 20 + [7.9]
        gap = [False] * 20 + [True]                                 # no heart rate after waking: on the charger
        self.assertEqual(truncated_nights(total, gap)[-1], 0)

    def test_a_short_night_that_stops_abruptly_is_cut(self):
        total = [7.5] * 20 + [2.2]
        gap = [False] * 20 + [True]
        self.assertEqual(truncated_nights(total, gap)[-1], 1)

    def test_a_short_night_with_readings_after_waking_is_real(self):
        total = [7.5] * 20 + [2.2]
        gap = [False] * 21
        self.assertEqual(truncated_nights(total, gap)[-1], 0)

    def test_short_is_judged_against_the_wearers_usual(self):
        long_sleeper = truncated_nights([9.0] * 20 + [6.5], [False] * 20 + [True])[-1]
        short_sleeper = truncated_nights([6.0] * 20 + [6.5], [False] * 20 + [True])[-1]
        self.assertEqual((long_sleeper, short_sleeper), (1, 0))      # 6.5 h is under 0.75 x 9 but not under 0.75 x 6

    def test_little_history_uses_the_default(self):
        self.assertEqual(truncated_nights([7.5, 7.5, 5.0], [False, False, True]), [0, 0, 1])   # under 0.75 x 7 h
        self.assertEqual(truncated_nights([7.5, 7.5, 5.5], [False, False, True]), [0, 0, 0])

    def test_unknown_stays_unknown_and_cut_nights_do_not_lower_the_usual(self):
        total = [8.0] * 10 + [2.0] * 5 + [5.5, None]
        gap = [False] * 10 + [True] * 5 + [True, True]
        got = truncated_nights(total, gap)
        self.assertEqual(got[10:15], [1] * 5)
        self.assertEqual(got[15], 1)                                 # still judged against the 8 h nights
        self.assertIsNone(got[16])
        self.assertIsNone(truncated_nights([7.0], [None])[0])


if __name__ == "__main__":
    unittest.main()
