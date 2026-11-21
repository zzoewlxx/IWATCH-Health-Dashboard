"""Day annotations the wearer keeps by hand (标注.csv): 生病、饮酒、熬夜 ...

Three columns: date, tags, note. The file is meant to be edited in a spreadsheet or a
text editor, so the reader is forgiving: UTF-8 with or without BOM, or GBK (what Excel
on a Chinese system saves); dates as 2025-03-08, 2025/3/8 or 2025.3.8; several tags
in one cell separated by 、 , ; or /.
"""
from __future__ import annotations

import csv
import io
import re
from datetime import date
from pathlib import Path

_DATE = re.compile(r"^\s*(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\s*$")
_TAG_SPLIT = re.compile(r"[、,，;；/|]+")
_HEADER_WORDS = {"日期", "date", "标签", "tag", "tags", "备注", "note", "notes"}


def _decode(raw: bytes) -> str:
    for enc in ("utf-8-sig", "gb18030"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def parse_date(text: str) -> str | None:
    """'2025/3/8' -> '2025-03-08'; None when it is not a real date."""
    m = _DATE.match(text or "")
    if not m:
        return None
    try:
        return date(*(int(g) for g in m.groups())).isoformat()
    except ValueError:                                # e.g. 2025-02-30
        return None


def parse_annotations(text: str) -> tuple[list[dict], list[str]]:
    """-> ([{date, tags: [...], note}], warnings), one entry per date in file order."""
    by_date: dict[str, dict] = {}
    warnings: list[str] = []
    for line_no, row in enumerate(csv.reader(io.StringIO(text)), start=1):
        cells = [c.strip() for c in row]
        if not any(cells) or cells[0].startswith("#"):
            continue
        if cells[0].lower() in _HEADER_WORDS:
            continue
        day = parse_date(cells[0])
        if day is None:
            warnings.append(f"第 {line_no} 行的日期看不懂：{cells[0]!r}")
            continue
        tags = [t.strip() for t in _TAG_SPLIT.split(cells[1])] if len(cells) > 1 else []
        tags = [t for t in tags if t]
        note = cells[2] if len(cells) > 2 else ""
        if not tags and not note:
            warnings.append(f"第 {line_no} 行没有标签也没有备注")
            continue
        entry = by_date.setdefault(day, {"date": day, "tags": [], "note": ""})
        for t in tags:
            if t not in entry["tags"]:
                entry["tags"].append(t)
        if note:
            entry["note"] = (entry["note"] + "；" + note) if entry["note"] else note
    return list(by_date.values()), warnings


def read_annotations(path: Path, day_index: dict[str, int]) -> tuple[list[dict], list[str]]:
    """Annotations that fall inside the data, each with its day index ``d``; plus warnings.

    A missing file is not an error: annotations are optional.
    """
    if not path.is_file():
        return [], []
    try:
        entries, warnings = parse_annotations(_decode(path.read_bytes()))
    except (OSError, csv.Error) as exc:
        return [], [f"{path.name} 读取失败：{exc}"]
    kept = []
    outside = 0
    for e in entries:
        d = day_index.get(e["date"])
        if d is None:
            outside += 1
            continue
        kept.append({"d": d, "tags": e["tags"], "note": e["note"]})
    if outside:
        warnings.append(f"{path.name} 里有 {outside} 天不在数据的日期范围内，已跳过")
    kept.sort(key=lambda e: e["d"])
    return kept, [f"{path.name}：{w}" if not w.startswith(path.name) else w for w in warnings]
