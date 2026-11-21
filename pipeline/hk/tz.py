"""Where was the wearer, in time-zone terms?

The export writes every timestamp in the phone's *current* offset (e.g. +0800), so a
night slept eight time zones away looks like it started at breakfast. To bucket data into the days the
wearer actually lived, and to show bedtimes in local clock time, we rebuild a time-zone
timeline:

1. Explicit: sleep samples and workouts carry an ``HKTimeZone`` metadata entry.
2. Inferred: for long stretches without metadata that sit between two different zones,
   each day votes for the zone whose calendar day reproduces Apple's own
   ``ActivitySummary`` total (which is stored per local calendar day).
3. Overrides from config.json win over both.
"""
from __future__ import annotations

import calendar
from bisect import bisect_left, bisect_right
from collections import Counter
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore

DAY = 86400
# Used only when the tz database is unavailable (Windows without the `tzdata` package).
_FIXED_HOURS = {
    "Asia/Shanghai": 8, "Asia/Hong_Kong": 8, "Asia/Macau": 8, "Asia/Taipei": 8, "Asia/Singapore": 8,
    "Asia/Tokyo": 9, "Asia/Seoul": 9, "Asia/Bangkok": 7, "Asia/Ho_Chi_Minh": 7, "UTC": 0,
}
_zone_cache: dict[str, object] = {}
warnings: list[str] = []


def _zone(name: str):
    if name not in _zone_cache:
        z = None
        if ZoneInfo is not None and not name.startswith("UTC"):
            try:
                z = ZoneInfo(name)
            except Exception:
                z = None
        _zone_cache[name] = z
    return _zone_cache[name]


def fixed_name(offset: int) -> str:
    sign = "+" if offset >= 0 else "-"
    return f"UTC{sign}{abs(offset) // 3600:02d}:{abs(offset) % 3600 // 60:02d}"


def offset_at(name: str, ts: int, default: int = 0) -> int:
    """UTC offset in seconds of zone ``name`` at instant ``ts``."""
    z = _zone(name)
    if z is not None:
        return int(datetime.fromtimestamp(ts, z).utcoffset().total_seconds())
    if name.startswith("UTC") and len(name) >= 9:
        sec = int(name[4:6]) * 3600 + int(name[7:9]) * 60
        return -sec if name[3] == "-" else sec
    if name in _FIXED_HOURS:
        return _FIXED_HOURS[name] * 3600
    msg = f"未知时区 {name}（缺少 tzdata），按导出文件的时区处理"
    if msg not in warnings:
        warnings.append(msg)
    return default


def date_ts(date: str) -> int:
    """'YYYY-MM-DD' -> epoch seconds of that date's 00:00 UTC."""
    return calendar.timegm((int(date[:4]), int(date[5:7]), int(date[8:10]), 0, 0, 0))


def ts_date(ts: int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")


class Timeline:
    """Piecewise time-zone assignment; answers "what was the local offset at ts?"."""

    def __init__(self, segments: list[list], horizon: int, default_offset: int):
        # segments: [start_ts, tz_name, how]; each runs until the next one starts.
        self.segments = _merge(segments)
        self.default_offset = default_offset
        self._starts: list[int] = []
        self._offs: list[int] = []
        for i, (start, name, _how) in enumerate(self.segments):
            end = self.segments[i + 1][0] if i + 1 < len(self.segments) else horizon
            off = offset_at(name, start, default_offset)
            self._push(start, off)
            t = start
            while t < end:                      # walk day by day looking for DST changes
                nt = min(t + DAY, end)
                noff = offset_at(name, nt - 1, default_offset)
                if noff != off:
                    lo, hi = t, nt              # narrow the transition to the minute
                    while hi - lo > 60:
                        mid = (lo + hi) // 2
                        if offset_at(name, mid, default_offset) == off:
                            lo = mid
                        else:
                            hi = mid
                    off = noff
                    self._push(hi, off)
                t = nt

    def _push(self, ts: int, off: int) -> None:
        if self._offs and self._offs[-1] == off:
            return
        self._starts.append(ts)
        self._offs.append(off)

    def offset(self, ts: int) -> int:
        i = bisect_right(self._starts, ts) - 1
        return self._offs[i if i >= 0 else 0]

    def name(self, ts: int) -> str:
        starts = [s[0] for s in self.segments]
        i = bisect_right(starts, ts) - 1
        return self.segments[i if i >= 0 else 0][1]

    def local_day(self, ts: int) -> int:
        """Day number (days since 1970-01-01) of the local calendar date at ``ts``."""
        return (ts + self.offset(ts)) // DAY

    def describe(self, first_ts: int, last_ts: int) -> list[dict]:
        out = []
        for i, (start, name, how) in enumerate(self.segments):
            end = self.segments[i + 1][0] if i + 1 < len(self.segments) else last_ts
            a, b = max(start, first_ts), min(end, last_ts)
            if b <= a:
                continue
            out.append({
                "from": ts_date(a + offset_at(name, a, self.default_offset)),
                "to": ts_date(b - 1 + offset_at(name, b - 1, self.default_offset)),
                "tz": name, "how": how,
            })
        return out


def _merge(segments: list[list]) -> list[list]:
    out: list[list] = []
    for seg in sorted(segments, key=lambda s: s[0]):
        if out and out[-1][1] == seg[1] and out[-1][2] == seg[2]:
            continue
        if out and out[-1][0] == seg[0]:
            out[-1] = list(seg)
            continue
        out.append(list(seg))
    return out


class EnergyIndex:
    """Prefix sums over de-duplicated active-energy samples, for window totals."""

    def __init__(self, resolved: list[tuple]):
        self.ts = [r[0] for r in resolved]
        self.cum = [0.0]
        acc = 0.0
        for r in resolved:
            acc += r[2]
            self.cum.append(acc)

    def total(self, a: int, b: int) -> float:
        return self.cum[bisect_left(self.ts, b)] - self.cum[bisect_left(self.ts, a)]


def _vote_gap(days: list[str], a: str, b: str, energy: EnergyIndex, summary: dict[str, float],
              default: int) -> tuple[list[str | None], int]:
    """Label each calendar day in a metadata-free gap as zone ``a`` or ``b``."""
    votes: list[str | None] = []
    for d in days:
        s = summary.get(d)
        if s is None or s < 20:
            votes.append(None)
            continue
        base = date_ts(d)
        errs = {}
        for name in (a, b):
            t0 = base - offset_at(name, base, default)
            errs[name] = abs(energy.total(t0, t0 + DAY) - s)
        if abs(errs[a] - errs[b]) > max(3.0, 0.05 * s):
            votes.append(a if errs[a] < errs[b] else b)
        else:
            votes.append(None)
    n_votes = sum(v is not None for v in votes)
    labels: list[str | None] = []
    for i in range(len(days)):
        win = [v for v in votes[max(0, i - 3): i + 4] if v]
        c = Counter(win)
        labels.append(a if c[a] > c[b] else b if c[b] > c[a] else None)
    # fill unlabeled days from the nearest labeled neighbour
    last = None
    for i, lab in enumerate(labels):
        if lab is None:
            labels[i] = last
        else:
            last = lab
    nxt = None
    for i in range(len(labels) - 1, -1, -1):
        if labels[i] is None:
            labels[i] = nxt
        else:
            nxt = labels[i]
    # absorb runs shorter than 3 days into what came before
    i = 0
    while i < len(labels):
        j = i
        while j < len(labels) and labels[j] == labels[i]:
            j += 1
        if j - i < 3 and i > 0:
            for k in range(i, j):
                labels[k] = labels[i - 1]
        i = j
    # The 7-day majority blurs each switch by a few days: slide every boundary to the
    # day that agrees best with the raw votes around it.
    for i in range(1, len(labels)):
        if labels[i] == labels[i - 1] or labels[i] is None or labels[i - 1] is None:
            continue
        old, new = labels[i - 1], labels[i]
        lo, hi = max(1, i - 4), min(len(labels) - 1, i + 4)
        span = range(max(0, i - 7), min(len(labels), i + 8))

        def score(k: int) -> int:
            return sum((1 if votes[j] == (old if j < k else new) else -1) for j in span if votes[j])

        best = max(range(lo, hi + 1), key=lambda k: (score(k), -abs(k - i)))
        for j in range(min(best, i), max(best, i)):
            labels[j] = new if best < i else old
    return labels, n_votes


def build_timeline(hints: list[tuple[int, str]], first_ts: int, last_ts: int, export_offset: int,
                   energy: EnergyIndex | None, summary: dict[str, float],
                   overrides: list[dict] | None = None) -> Timeline:
    horizon = last_ts + 3 * DAY
    hints = sorted(hints)
    names = Counter(n for _, n in hints)
    home = next((n for n, _ in names.most_common() if offset_at(n, last_ts, export_offset) == export_offset),
                fixed_name(export_offset))

    runs: list[list] = []                       # [first_ts, last_ts, name]
    for ts, name in hints:
        if runs and runs[-1][2] == name:
            runs[-1][1] = ts
        else:
            runs.append([ts, ts, name])

    def gap(t0: int, t1: int, a: str, b: str, lead_known: bool) -> list[list]:
        """Segments for the metadata-free stretch (t0, t1): zone ``a`` held before it
        (a guess when ``lead_known`` is false) and zone ``b`` holds from t1 on."""
        simple = [[(t0 + t1) // 2, b, "metadata"]] if lead_known else [[t0, b, "inferred"]]
        if a == b:
            return [] if lead_known else [[t0, b, "metadata"]]
        far = abs(offset_at(a, t0, export_offset) - offset_at(b, t1, export_offset)) >= 3 * 3600
        days = []
        d = date_ts(ts_date(t0 + offset_at(a, t0, export_offset))) + DAY
        end_d = date_ts(ts_date(t1 + offset_at(b, t1, export_offset)))
        while d < end_d:
            days.append(ts_date(d))
            d += DAY
        if not far or len(days) < 4 or energy is None:
            return simple
        labels, n_votes = _vote_gap(days, a, b, energy, summary, export_offset)
        if n_votes < max(3, len(days) // 10) or labels[0] is None:
            return simple
        out: list[list] = []
        prev = None
        for day, lab in zip(days, labels):
            if lab != prev:
                base = date_ts(day)
                start = t0 if prev is None else base - offset_at(lab, base, export_offset)
                out.append([start, lab, "inferred"])
                prev = lab
        out.append([t1, b, "metadata"])           # from here on the zone is recorded, not guessed
        return out

    segs: list[list] = []
    start = first_ts - DAY
    if not runs:
        segs.append([start, home, "default"])
    else:
        first = runs[0]
        if first[0] - first_ts <= 3 * DAY:
            segs.append([start, first[2], "metadata"])
        else:
            segs.extend(gap(start, first[0], home, first[2], lead_known=False))
        for prev_run, cur in zip(runs, runs[1:]):
            segs.extend(gap(prev_run[1], cur[0], prev_run[2], cur[2], lead_known=True))

    for ov in overrides or []:
        try:
            name = ov["tz"]
            a = date_ts(ov["from"])
            a -= offset_at(name, a, export_offset)
            b = date_ts(ov["to"]) + DAY if ov.get("to") else horizon
            b -= offset_at(name, b, export_offset) if ov.get("to") else 0
        except (KeyError, ValueError):
            warnings.append(f"config.json 中的时区覆盖项无效：{ov}")
            continue
        segs = _apply_override(segs, a, b, name)

    return Timeline(segs, horizon, export_offset)


def _apply_override(segs: list[list], a: int, b: int, name: str) -> list[list]:
    segs = sorted(segs, key=lambda s: s[0])
    resume = None                                # what was active just before b
    for s in segs:
        if s[0] <= b:
            resume = s
    out = [s for s in segs if not (a <= s[0] < b)]
    out.append([a, name, "override"])
    if resume is not None and not any(s[0] == b for s in out):
        out.append([b, resume[1], resume[2]])
    return sorted(out, key=lambda s: s[0])
