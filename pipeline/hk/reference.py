"""The evidence table (pipeline/reference.json): reference ranges, parameters and sources.

The analysis reads its window lengths and thresholds from that file, and the dashboard
prints the same entries on its notes page, so what the page says is what the code does.
"""
from __future__ import annotations

import json
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "reference.json"
GRADES = ("A", "B", "C")
CHECKED = ("fulltext", "abstract", "official", "secondary")
SCORES = ("sleep", "activity")


def _check_sources(where: str, sources, problems: list[str]) -> None:
    if not isinstance(sources, list) or not sources:
        problems.append(f"{where}: 至少要有一条出处")
        return
    for k, s in enumerate(sources, start=1):
        for field in ("cite", "url", "finding", "checked"):
            if not isinstance(s.get(field), str) or not s[field].strip():
                problems.append(f"{where} 第 {k} 条出处缺少 {field}")
        if isinstance(s.get("url"), str) and not s["url"].startswith("https://"):
            problems.append(f"{where} 第 {k} 条出处的 url 应以 https:// 开头")
        if s.get("checked") not in CHECKED:
            problems.append(f"{where} 第 {k} 条出处的 checked 应为 {' / '.join(CHECKED)} 之一")


def validate(ref: dict) -> list[str]:
    """Every problem found in the table, as readable sentences (empty list = fine)."""
    problems: list[str] = []
    for key in ("about", "principles", "grades", "checked", "groups", "scores", "indicators", "excluded"):
        if key not in ref:
            problems.append(f"缺少顶层字段 {key}")
    if problems:
        return problems
    for g in GRADES:
        if g not in ref["grades"]:
            problems.append(f"grades 缺少等级 {g} 的说明")
    for c in CHECKED:
        if c not in ref["checked"]:
            problems.append(f"checked 缺少 {c} 的说明")
    seen: set[str] = set()
    for ind in ref["indicators"]:
        where = f"指标 {ind.get('id', '?')}"
        for field in ("id", "group", "name", "range", "method", "grade", "grade_note"):
            if not isinstance(ind.get(field), str) or not ind[field].strip():
                problems.append(f"{where} 缺少 {field}")
        if ind.get("id") in seen:
            problems.append(f"{where}: id 重复")
        seen.add(ind.get("id"))
        if ind.get("group") not in ref["groups"]:
            problems.append(f"{where}: group 不在 groups 里")
        if ind.get("grade") not in GRADES:
            problems.append(f"{where}: grade 应为 {' / '.join(GRADES)} 之一")
        if not isinstance(ind.get("params"), dict):
            problems.append(f"{where} 缺少 params")
        if not isinstance(ind.get("caveats"), list):
            problems.append(f"{where} 缺少 caveats")
        _check_sources(where, ind.get("sources"), problems)
    for ex in ref["excluded"]:
        where = f"未采用的指标 {ex.get('name', '?')}"
        for field in ("name", "reason"):
            if not isinstance(ex.get(field), str) or not ex[field].strip():
                problems.append(f"{where} 缺少 {field}")
        _check_sources(where, ex.get("sources"), problems)
    for name in SCORES:
        _check_score(name, ref["scores"].get(name), seen, problems)
    return problems


def _check_score(name: str, spec, indicator_ids: set, problems: list[str]) -> None:
    where = f"评分 {name}"
    if not isinstance(spec, dict) or not spec.get("label") or not isinstance(spec.get("parts"), list) or not spec["parts"]:
        problems.append(f"{where} 缺少 label 或 parts")
        return
    for part in spec["parts"]:
        pw = f"{where} 的 {part.get('key', '?')}"
        for field in ("key", "label", "rule"):
            if not isinstance(part.get(field), str) or not part[field].strip():
                problems.append(f"{pw} 缺少 {field}")
        if part.get("indicator") not in indicator_ids:
            problems.append(f"{pw}: indicator 不是已有的指标")
        curve = part.get("curve")
        ok = (isinstance(curve, list) and len(curve) >= 2
              and all(isinstance(pt, list) and len(pt) == 2 for pt in curve))
        if ok:
            xs, ys = [pt[0] for pt in curve], [pt[1] for pt in curve]
            ok = (xs == sorted(set(xs)) and ys == sorted(ys) and ys[0] == 0 and ys[-1] == 1)
        if not ok:
            problems.append(f"{pw}: curve 应是从 0 升到 1 的折线，例如 [[5, 0], [7, 1]]")
    total = sum(part.get("max", 0) for part in spec["parts"] if isinstance(part.get("max"), (int, float)))
    if total != 100:
        problems.append(f"{where}: 各部分的 max 加起来应是 100（现在是 {total:g}）")


def load_reference(path: Path = PATH) -> dict:
    ref = json.loads(path.read_text(encoding="utf-8"))
    problems = validate(ref)
    if problems:
        raise ValueError(f"{path.name} 有问题：\n  " + "\n  ".join(problems))
    return ref


def params_by_id(ref: dict) -> dict[str, dict]:
    return {ind["id"]: ind["params"] for ind in ref["indicators"]}
