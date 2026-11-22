"""VO2 max against the same age group and sex, on made-up readings."""
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))

from hk import fitness as F                                         # noqa: E402
from hk.reference import load_reference, params_by_id               # noqa: E402

PARAMS = params_by_id(load_reference())
P = PARAMS["vo2max_peers"]
N = 400
DAYS = [(date(2025, 1, 1) + timedelta(days=k)).isoformat() for k in range(N)]
MEN_20S = dict(P["table"]["male"])[20]                              # 5th ... 95th percentile


def readings(*pairs):
    vo2 = [None] * N
    for day, v in pairs:
        vo2[day] = v
    return vo2


def peers(vo2, age=25, sex="male"):
    return F.vo2_peers(days=DAYS, vo2=vo2, profile={"age": age, "sex": sex}, params=PARAMS)


class Interpolation(unittest.TestCase):
    def test_table_points_and_the_middle_between_them(self):
        pcts = P["percentiles"]
        for v, pct in zip(MEN_20S, pcts):
            self.assertAlmostEqual(F.percentile_of(v, MEN_20S, pcts)[0], pct)
        mid = (MEN_20S[3] + MEN_20S[4]) / 2                         # halfway from the 50th to the 75th
        self.assertAlmostEqual(F.percentile_of(mid, MEN_20S, pcts)[0], 62.5)
        self.assertEqual(F.percentile_of(MEN_20S[0] - 1, MEN_20S, pcts), (None, "below"))
        self.assertEqual(F.percentile_of(MEN_20S[-1] + 1, MEN_20S, pcts), (None, "above"))
        self.assertAlmostEqual(F.value_at(50, MEN_20S, pcts), MEN_20S[3])


class Peers(unittest.TestCase):
    def test_recent_readings_are_averaged_and_placed(self):
        out = peers(readings((300, 40.0), (380, 47.0), (390, 49.0)))
        self.assertEqual((out["value"], out["n"], out["last"]), (48.0, 2, DAYS[390]))   # day 300 is too old
        self.assertEqual(out["pct"], 50)                            # 48.0 is the 50th percentile for men in their 20s
        self.assertEqual(out["group"], [20, 29])
        self.assertEqual(out["vsMedianMet"], 0)
        self.assertFalse(out["low"])
        self.assertLess(out["pctLo"], 50)
        self.assertGreater(out["pctHi"], 50)

    def test_the_low_range_follows_apple(self):
        out = peers(readings((390, 33.0)))                          # below the 20th percentile (about 37.4)
        self.assertTrue(out["low"])
        self.assertAlmostEqual(out["lowLine"], round(MEN_20S[1] + (MEN_20S[2] - MEN_20S[1]) * 10 / 15, 1))
        older = peers(readings((390, 19.0)), age=67)                # from 60 on: a fixed line, 18 for men
        self.assertFalse(older["low"])
        self.assertEqual(older["lowLine"], 18)
        self.assertEqual(older["group"], [60, 69])

    def test_eighty_and_over_use_the_oldest_group(self):
        out = peers(readings((390, 22.0)), age=84, sex="female")
        self.assertEqual(out["group"], [70, 79])
        self.assertTrue(out["beyond"])

    def test_no_comparison_without_what_it_needs(self):
        self.assertIsNone(peers([None] * N))
        self.assertEqual(peers(readings((390, 45.0)), sex=None)["why"], "profile")
        self.assertEqual(peers(readings((390, 45.0)), age=17)["why"], "young")
        stale = peers(readings((100, 45.0)))
        self.assertEqual(stale["why"], "stale")
        self.assertIsNone(stale["pct"])


if __name__ == "__main__":
    unittest.main()
