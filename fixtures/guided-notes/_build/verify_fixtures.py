#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

FIXTURE_DIR = Path(__file__).resolve().parent.parent
LABELS = ("題號", "題目", "作答")
PREFIX_RE = re.compile(r"（[1-9][0-9]*）")


class ParseError(ValueError):
    pass


def find_header(workbook):
    for ws in workbook.worksheets:
        for row in ws.iter_rows():
            found = {}
            for cell in row:
                if isinstance(cell.value, str):
                    label = cell.value.strip()
                    if label in LABELS and label not in found:
                        found[label] = cell.column
            if len(found) == len(LABELS):
                columns = [found[label] for label in LABELS]
                if columns != sorted(columns) or len(set(columns)) != 3:
                    raise ParseError("invalid header order")
                return ws, row[0].row, dict(zip(LABELS, columns))
    raise ParseError("missing header row")


def numeric_question_rows(ws, header_row, number_column):
    questions = []
    for row in range(header_row + 1, ws.max_row + 1):
        value = ws.cell(row, number_column).value
        if (
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and float(value).is_integer()
        ):
            questions.append((row, int(value)))
    return questions


def vertical_number_span(ws, row, column):
    for merged in ws.merged_cells.ranges:
        if (
            merged.min_row == row
            and merged.min_col == merged.max_col == column
        ):
            return range(row, merged.max_row + 1)
    return range(row, row + 1)


def answer_cell(ws, row, column):
    cell = ws.cell(row, column)
    for merged in ws.merged_cells.ranges:
        if (
            merged.min_row <= row <= merged.max_row
            and merged.min_col <= column <= merged.max_col
        ):
            cell = ws.cell(merged.min_row, merged.min_col)
            break
    value = "" if cell.value is None else str(cell.value).strip()
    if value and not PREFIX_RE.fullmatch(value):
        raise ParseError(f"unexpected answer content: {cell.coordinate}")
    return {"cell": cell.coordinate, "prefix": value}


def parse_fixture(path):
    workbook = load_workbook(path, data_only=False)
    try:
        ws, header_row, columns = find_header(workbook)
        numbered_rows = numeric_question_rows(
            ws, header_row, columns["題號"]
        )
        seen = set()
        for _, number in numbered_rows:
            if number in seen:
                raise ParseError(f"duplicate question number: {number}")
            seen.add(number)
        if not numbered_rows:
            raise ParseError("no questions")

        questions = []
        for row, number in numbered_rows:
            rows = vertical_number_span(ws, row, columns["題號"])
            blanks = [answer_cell(ws, subrow, columns["作答"]) for subrow in rows]
            questions.append({"number": number, "blanks": blanks})

        return {
            "sheet": ws.title,
            "header_row": header_row,
            "questions": questions,
            "question_count": len(questions),
            "blank_count": sum(len(question["blanks"]) for question in questions),
        }
    finally:
        workbook.close()


def main():
    expected_items = json.loads((FIXTURE_DIR / "expected.json").read_text("utf-8"))
    passed = 0
    failed = 0
    for expected in expected_items:
        filename = expected["file"]
        path = FIXTURE_DIR / filename
        if not path.is_file():
            print(f"FAIL {filename}: fixture file not found")
            failed += 1
            continue
        try:
            parsed = parse_fixture(path)
            actual = {"file": filename, "valid": True, **parsed}
        except (ParseError, OSError, ValueError) as exc:
            actual = {"file": filename, "valid": False, "error": str(exc)}

        if actual == expected:
            detail = (
                f"expected rejection: {actual['error']}"
                if not actual["valid"]
                else f"{actual['question_count']} questions, {actual['blank_count']} blanks"
            )
            print(f"PASS {filename}: {detail}")
            passed += 1
        else:
            print(f"FAIL {filename}")
            print("  expected:", json.dumps(expected, ensure_ascii=False, sort_keys=True))
            print("  actual:  ", json.dumps(actual, ensure_ascii=False, sort_keys=True))
            failed += 1

    print(f"SUMMARY: {passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
