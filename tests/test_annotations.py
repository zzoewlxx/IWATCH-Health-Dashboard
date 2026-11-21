"""Reading the hand-kept annotation file (标注.csv). All dates and notes here are made up."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))

from hk.annotations import parse_annotations, parse_date, read_annotations      # noqa: E402


class ParseDate(unittest.TestCase):
    def test_spreadsheet_date_styles(self):
        for text in ("2025-03-08", "2025/3/8", "2025.03.08", " 2025年3月8日 "):
            self.assertEqual(parse_date(text), "2025-03-08", text)

    def test_not_a_date(self):
        for text in ("", "昨天", "2025-13-01", "2025-02-30", "03-08"):
            self.assertIsNone(parse_date(text), text)


class ParseAnnotations(unittest.TestCase):
    def test_header_comments_and_blank_lines_are_skipped(self):
        text = "日期,标签,备注\n# 一行说明\n\n2025-03-08,生病,感冒\n"
        entries, warnings = parse_annotations(text)
        self.assertEqual(entries, [{"date": "2025-03-08", "tags": ["生病"], "note": "感冒"}])
        self.assertEqual(warnings, [])

    def test_several_tags_in_one_cell(self):
        entries, _ = parse_annotations('2025-03-08,"饮酒、熬夜",\n2025-03-09,旅行/熬夜;压力大\n')
        self.assertEqual(entries[0]["tags"], ["饮酒", "熬夜"])
        self.assertEqual(entries[1]["tags"], ["旅行", "熬夜", "压力大"])

    def test_rows_for_the_same_day_are_merged(self):
        entries, _ = parse_annotations("2025-03-08,生病,发烧\n2025/3/8,生病、熬夜,没睡好\n")
        self.assertEqual(entries, [{"date": "2025-03-08", "tags": ["生病", "熬夜"], "note": "发烧；没睡好"}])

    def test_a_note_alone_is_enough(self):
        entries, warnings = parse_annotations("2025-03-08,,搬家\n")
        self.assertEqual(entries, [{"date": "2025-03-08", "tags": [], "note": "搬家"}])
        self.assertEqual(warnings, [])

    def test_bad_rows_are_reported_with_their_line_number(self):
        entries, warnings = parse_annotations("日期,标签\n三月八号,生病\n2025-03-09\n2025-03-10,饮酒\n")
        self.assertEqual([e["date"] for e in entries], ["2025-03-10"])
        self.assertEqual(len(warnings), 2)
        self.assertIn("第 2 行", warnings[0])
        self.assertIn("第 3 行", warnings[1])


class ReadAnnotations(unittest.TestCase):
    INDEX = {"2025-03-07": 0, "2025-03-08": 1, "2025-03-09": 2}

    def read(self, raw: bytes):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "标注.csv"
            path.write_bytes(raw)
            return read_annotations(path, self.INDEX)

    def test_missing_file_is_fine(self):
        self.assertEqual(read_annotations(Path("no-such-file.csv"), self.INDEX), ([], []))

    def test_utf8_with_and_without_bom(self):
        text = "日期,标签,备注\n2025-03-08,生病,感冒\n"
        for raw in (text.encode("utf-8"), text.encode("utf-8-sig")):
            self.assertEqual(self.read(raw), ([{"d": 1, "tags": ["生病"], "note": "感冒"}], []))

    def test_file_saved_by_excel_on_a_chinese_system(self):
        raw = "日期,标签,备注\r\n2025/3/9,饮酒,聚餐\r\n".encode("gbk")
        self.assertEqual(self.read(raw), ([{"d": 2, "tags": ["饮酒"], "note": "聚餐"}], []))

    def test_days_outside_the_data_are_skipped_and_counted(self):
        entries, warnings = self.read("2025-03-09,熬夜\n2024-01-01,生病\n2025-03-07,旅行\n".encode("utf-8"))
        self.assertEqual([e["d"] for e in entries], [0, 2])              # sorted by day
        self.assertEqual(len(warnings), 1)
        self.assertIn("1 天不在数据的日期范围内", warnings[0])


if __name__ == "__main__":
    unittest.main()
