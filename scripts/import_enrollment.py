"""Import term-level enrollment from WPU's supplied pivot workbook.

The pivot uses formatting levels: styles 6 and 10 are major labels, style 7
is a term total, and style 9 is a lower-level demographic value.  Reading the
style hierarchy prevents labels such as GR and Postgraduate from becoming
separate majors.
"""

from __future__ import annotations

import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
TERM_RE = re.compile(r"^(FA|SP|SU)(20\d{2})$")
MAJOR_STYLES = {"6", "10"}
TERM_STYLE = "7"
DETAIL_STYLE = "9"


def column(ref: str) -> str:
    return "".join(char for char in ref if char.isalpha())


def shared_strings(archive: zipfile.ZipFile) -> list[str]:
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    return ["".join(node.text or "" for node in item.iter(f"{NS}t")) for item in root.findall(f"{NS}si")]


def cell_value(cell, strings: list[str]) -> str:
    raw = cell.findtext(f"{NS}v")
    if raw is None:
        inline = cell.find(f"{NS}is")
        return "".join(node.text or "" for node in inline.iter(f"{NS}t")) if inline is not None else ""
    return strings[int(raw)] if cell.get("t") == "s" else raw


def rows(source: Path):
    with zipfile.ZipFile(source) as archive:
        strings = shared_strings(archive)
        root = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        for row in root.findall(f".//{NS}sheetData/{NS}row"):
            cells = {column(cell.get("r")): cell for cell in row.findall(f"{NS}c")}
            label = cell_value(cells["A"], strings).strip() if "A" in cells else ""
            value = cell_value(cells["B"], strings) if "B" in cells else ""
            style = cells["A"].get("s") if "A" in cells else ""
            yield label, value, style


def integer(value: str) -> int | None:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def term_key(term: str):
    return int(term[2:]), {"SP": 0, "SU": 1, "FA": 2}[term[:2]]


def import_enrollment(source: Path) -> dict:
    majors: dict[str, dict] = {}
    current_major = None
    current_term = None
    for label, raw_value, style in rows(source):
        count = integer(raw_value)
        if not label or label == "Row Labels" or count is None:
            continue
        if style in MAJOR_STYLES:
            current_major = label
            current_term = None
            majors.setdefault(current_major, {"terms": {}})
            continue
        if TERM_RE.match(label) and style == TERM_STYLE:
            if current_major is None:
                raise ValueError(f"Found term {label} before a major label.")
            current_term = label
            majors[current_major]["terms"][label] = {"headcount": count, "levels": {}}
            continue
        if style == DETAIL_STYLE and current_major and current_term:
            majors[current_major]["terms"][current_term]["levels"][label] = count

    majors = {name: value for name, value in majors.items() if value["terms"]}
    if not majors:
        raise ValueError("No major-term enrollment records were found.")
    return {
        "source": source.name,
        "method": "Count of Student ID by declared major and term from supplied pivot export",
        "terms": sorted({term for value in majors.values() for term in value["terms"]}, key=term_key),
        "majors": dict(sorted(majors.items())),
    }


def main(source: str, output: str) -> None:
    payload = import_enrollment(Path(source))
    destination = Path(output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text("window.ENROLLMENT_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"Wrote {len(payload['majors'])} major records and {len(payload['terms'])} terms to {destination}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: import_enrollment.py SOURCE.xlsx enrollment-data.js")
    main(sys.argv[1], sys.argv[2])
