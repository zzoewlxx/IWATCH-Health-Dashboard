"""Your own comparisons, on made-up nights: intervals, strata, the correction, the groups."""
import random
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))

from hk import contrasts as C                                       # noqa: E402
from hk.reference import load_reference, params_by_id               # noqa: E402

PARAMS = params_by_id(load_reference())
OPTS = dict(min_nights=8, min_per_stratum=3, resamples=1000, level=0.95, seed=3)


def nights(values, stratum=0):
    return [(v, stratum) for v in values]


class Compare(unittest.TestCase):
    def test_a_clear_difference_has_an_interval_away_from_zero(self):
        rng = random.Random(1)
        a = nights([30 + rng.gauss(0, 5) for _ in range(30)])
        b = nights([rng.gauss(0, 5) for _ in range(30)])
        r = C.compare(a, b, **OPTS)
        self.assertAlmostEqual(r["diff"], sum(v for v, _ in a) / 30 - sum(v for v, _ in b) / 30)
        self.assertGreater(r["lo"], 20)
        self.assertLess(r["hi"], 40)
        self.assertLess(r["p"], 0.01)

    def test_no_difference_crosses_zero(self):
        rng = random.Random(2)
        values = [rng.gauss(0, 5) for _ in range(25)]
        r = C.compare(nights(values), nights(values[::-1] + values[:10]), **OPTS)
        self.assertLess(r["lo"], 0)
        self.assertGreater(r["hi"], 0)

    def test_too_few_nights_gives_no_answer(self):
        r = C.compare(nights([1.0] * 7), nights([0.0] * 30), **OPTS)
        self.assertIsNone(r["diff"])
        self.assertEqual((r["nA"], r["nB"]), (7, 30))

    def test_weekends_are_compared_with_weekends(self):
        # group a has mostly weekend nights, which are an hour later for everyone: no real difference
        a = nights([60.0] * 12, 1) + nights([0.0] * 4, 0)
        b = nights([60.0] * 4, 1) + nights([0.0] * 12, 0)
        r = C.compare(a, b, **OPTS)
        self.assertEqual(r["diff"], 0)
        self.assertEqual((r["lo"], r["hi"]), (0, 0))
        self.assertEqual(r["meanA"] - r["meanB"], 30)               # the naive comparison would say 30

    def test_the_same_seed_gives_the_same_interval(self):
        rng = random.Random(4)
        a, b = nights([rng.gauss(1, 3) for _ in range(20)]), nights([rng.gauss(0, 3) for _ in range(20)])
        self.assertEqual(C.compare(a, b, **OPTS), C.compare(a, b, **OPTS))


class Correction(unittest.TestCase):
    def test_benjamini_hochberg(self):
        q = C.bh_adjust([0.01, 0.04, 0.03, 0.5])
        self.assertEqual([round(x, 4) for x in q], [0.04, 0.0533, 0.0533, 0.5])

    def test_adjusted_values_keep_their_order(self):
        p = [0.2, 0.001, 0.04, 0.03, 0.9]
        q = C.bh_adjust(p)
        order = sorted(range(5), key=lambda k: p[k])
        self.assertEqual([q[k] for k in order], sorted(q))


class Groups(unittest.TestCase):
    """Sixty nights: bedtime 23:30, an hour later after evening workouts; headphones every third night."""

    def setUp(self):
        n = 60
        self.days = [(date(2025, 3, 3) + timedelta(days=k)).isoformat() for k in range(n)]
        self.daily = {"bedtime": [-30] * n, "sleepTotal": [7.5] * n, "sleepCut": [0] * n,
                      "sleepHr": [58.0 + (k % 3) * 0.5 for k in range(n)], "sleepHrv": [50.0] * n,
                      "daylight": [20 + (k % 6) * 20 for k in range(n)]}
        self.workouts = []
        for d in range(1, n, 2):                                    # every other evening, 20:00-21:00
            self.workouts.append({"d": d - 1, "time": "20:00", "min": 60.0})
            self.daily["bedtime"][d] = 30
        self.sessions = [[d - 1, 23 * 60, 20, 20] for d in range(3, n, 3)]   # 23:00-23:20

    def build(self, annotations=()):
        return C.build_contrasts(days=self.days, daily=self.daily, workouts=self.workouts, sessions=self.sessions,
                                 annotations=list(annotations), params=PARAMS)

    def item(self, out, cid):
        return next(x for x in out["items"] if x["id"] == cid)

    def test_a_late_night_after_an_evening_workout_still_counts_as_one(self):
        self.daily["bedtime"][5] = 200                              # 03:20: still "the night after the workout"
        ev = self.item(self.build(), "evening_workout")
        self.assertEqual(ev["nA"], 30)

    def test_evening_workouts_against_rest_days(self):
        ev = self.item(self.build(), "evening_workout")
        self.assertEqual((ev["nA"], ev["nB"]), (30, 29))
        bed = next(r for r in ev["rows"] if r["key"] == "bedtime")
        self.assertEqual(bed["diff"], 60)
        self.assertEqual(bed["verdict"], "clear")
        hrv = next(r for r in ev["rows"] if r["key"] == "sleepHrv")
        self.assertEqual(hrv["verdict"], "none")                    # identical HRV: interval sits on zero

    def test_headphones_in_the_hour_before_sleep(self):
        hp = self.item(self.build(), "listen_before_sleep")
        heard = hp["nA"]
        self.assertEqual(heard, len([d for d in range(3, 60, 3) if self.daily["bedtime"][d] == -30]))
        self.assertEqual(hp["nA"] + hp["nB"], 56)                   # from the first listening day to the day after the last
        self.assertEqual([r["key"] for r in hp["rows"]], ["sleepTotal", "sleepHr", "sleepHrv"])   # not bedtime

    def test_daylight_thirds(self):
        dl = self.item(self.build(), "daylight")
        self.assertIn("100", dl["a"])
        self.assertIn("40", dl["b"])

    def test_tags_need_enough_days_and_compare_with_untagged_ones(self):
        notes = [{"d": d, "tags": ["饮酒"], "note": ""} for d in range(10, 50, 4)]           # ten evenings
        notes += [{"d": 51, "tags": ["生病"], "note": ""}]
        out = self.build(notes)
        tag = self.item(out, "tag:饮酒")
        self.assertEqual(tag["nA"], 10)
        self.assertEqual(out["tagsPending"], [{"tag": "生病", "days": 1}])

    def test_verdicts_cover_every_row(self):
        out = self.build()
        for item in out["items"]:
            for r in item["rows"]:
                self.assertIn(r["verdict"], ("clear", "maybe", "none", "few"))
                if r["verdict"] in ("clear", "maybe"):
                    self.assertTrue(r["lo"] > 0 or r["hi"] < 0)


if __name__ == "__main__":
    unittest.main()
