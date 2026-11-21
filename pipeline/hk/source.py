"""Locate Apple Health exports (unzipped folders or .zip archives) and read their members.

An export is whatever the iPhone's "导出所有健康数据" produced: a zip, or the folder
you get after unzipping it. The main file is ``export.xml`` (``导出.xml`` on a Chinese
system); ``export_cda.xml`` is a clinical-document duplicate and is ignored.
"""
from __future__ import annotations

import re
import zipfile
from pathlib import Path
from typing import BinaryIO

_HEAD_BYTES = 512 * 1024
_EXPORT_DATE = re.compile(rb'<ExportDate\s+value="([^"]+)"')


def _is_main_name(name: str) -> bool:
    low = name.lower()
    return low.endswith(".xml") and "cda" not in low


def _head_info(head: bytes) -> tuple[bool, str | None]:
    """(looks like the HealthKit export, ExportDate value)"""
    if b"HealthData" not in head:
        return False, None
    m = _EXPORT_DATE.search(head)
    return True, m.group(1).decode("ascii", "replace") if m else None


class ExportSource:
    """One export: a directory or a zip archive that holds the main XML."""

    def __init__(self, path: Path, kind: str, main: str, export_date: str | None):
        self.path = path
        self.kind = kind            # "dir" | "zip"
        self.main = main            # file name (dir) or archive member (zip)
        self.export_date = export_date
        self.mtime = path.stat().st_mtime

    def __repr__(self) -> str:
        return f"ExportSource({self.kind}, {self.path}, export_date={self.export_date})"

    @property
    def label(self) -> str:
        return str(self.path)

    def open_main(self) -> BinaryIO:
        if self.kind == "dir":
            return open(self.path / self.main, "rb")
        zf = zipfile.ZipFile(self.path)
        return zf.open(self.main)

    def members(self, folder: str, suffix: str) -> list[str]:
        """Names of files inside ``folder`` (e.g. 'electrocardiograms') with ``suffix``."""
        if self.kind == "dir":
            d = self.path / folder
            if not d.is_dir():
                return []
            return sorted(p.name for p in d.iterdir() if p.name.lower().endswith(suffix))
        with zipfile.ZipFile(self.path) as zf:
            return sorted(
                n for n in zf.namelist()
                if f"/{folder}/" in "/" + n and n.lower().endswith(suffix)
            )

    def read(self, folder: str, name: str) -> bytes:
        if self.kind == "dir":
            return (self.path / folder / name).read_bytes()
        with zipfile.ZipFile(self.path) as zf:
            return zf.read(name)


def _probe_dir(d: Path) -> ExportSource | None:
    best = None
    for p in d.iterdir():
        if p.is_file() and _is_main_name(p.name):
            with open(p, "rb") as f:
                ok, date = _head_info(f.read(_HEAD_BYTES))
            if ok and (best is None or p.stat().st_size > best[1]):
                best = (p.name, p.stat().st_size, date)
    return ExportSource(d, "dir", best[0], best[2]) if best else None


def _probe_zip(z: Path) -> ExportSource | None:
    try:
        with zipfile.ZipFile(z) as zf:
            cands = [i for i in zf.infolist() if not i.is_dir() and _is_main_name(i.filename)]
            cands.sort(key=lambda i: -i.file_size)
            for info in cands:
                with zf.open(info) as f:
                    ok, date = _head_info(f.read(_HEAD_BYTES))
                if ok:
                    return ExportSource(z, "zip", info.filename, date)
    except (zipfile.BadZipFile, OSError):
        return None
    return None


def find_exports(root: Path, max_depth: int = 5) -> list[ExportSource]:
    """Every export under ``root``, newest first (by ExportDate, then file time)."""
    found: list[ExportSource] = []

    def walk(d: Path, depth: int) -> None:
        try:
            entries = list(d.iterdir())
        except OSError:
            return
        src = _probe_dir(d)
        if src:
            found.append(src)
        for p in entries:
            if p.is_dir() and depth < max_depth:
                walk(p, depth + 1)
            elif p.is_file() and p.suffix.lower() == ".zip":
                src = _probe_zip(p)
                if src:
                    found.append(src)

    if root.is_dir():
        walk(root, 0)
    # A folder and the zip it came from carry the same ExportDate: prefer the folder.
    found.sort(key=lambda s: (s.export_date or "", s.kind == "dir", s.mtime), reverse=True)
    return found
