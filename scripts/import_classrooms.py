"""Import WPU classroom inventory without assuming availability or suitability."""

from __future__ import annotations

import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def column_index(reference: str) -> int:
    result = 0
    for char in re.match(r"[A-Z]+", reference).group(0):
        result = result * 26 + ord(char) - 64
    return result - 1


def cells(source: Path):
    with zipfile.ZipFile(source) as archive:
        strings_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
        strings = ["".join(node.text or "" for node in item.iter(f"{NS}t")) for item in strings_root.findall(f"{NS}si")]
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        for row in sheet.findall(f".//{NS}sheetData/{NS}row"):
            values = {}
            for cell in row.findall(f"{NS}c"):
                raw = cell.findtext(f"{NS}v")
                if raw is None:
                    inline = cell.find(f"{NS}is")
                    value = "".join(node.text or "" for node in inline.iter(f"{NS}t")) if inline is not None else ""
                else:
                    value = strings[int(raw)] if cell.get("t") == "s" else raw
                values[column_index(cell.get("r"))] = value.strip() if isinstance(value, str) else value
            if values:
                yield int(row.get("r")), values


def normal(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def find_column(headers: dict[int, str], names: tuple[str, ...]) -> int | None:
    for index, label in headers.items():
        if any(name in normal(label) for name in names):
            return index
    return None


def capacity(value) -> int | None:
    values = [int(number) for number in re.findall(r"\d+", str(value))]
    return max(values) if values else None


def restrictions(room: str, inventory: str) -> list[str]:
    searchable = f"{room} {inventory}".lower()
    notes = []
    if "not a classroom" in searchable:
        notes.append("Not a classroom")
    if re.search(r"can.{0,3}t be used for other classes", searchable):
        notes.append("Inventory restricts this space to its identified use")
    return notes


def import_classrooms(source: Path) -> dict:
    rows = list(cells(source))
    header_number, headers = next((number, values) for number, values in rows[:20] if "seat" in " ".join(map(str, values.values())).lower() or "capacity" in " ".join(map(str, values.values())).lower())
    room_column = find_column(headers, ("room", "classroom", "location"))
    capacity_column = find_column(headers, ("seat", "capacity", "cap"))
    building_column = find_column(headers, ("building",))
    inventory_column = find_column(headers, ("inventory", "technology", "tech", "feature"))
    source_section_column = find_column(headers, ("sourcesection",))
    if room_column is None or capacity_column is None:
        raise ValueError(f"Room and capacity columns are required. Headers: {list(headers.values())}")

    rooms = []
    for _, row in rows:
        if _ <= header_number:
            continue
        room = str(row.get(room_column, "")).strip()
        if not room:
            continue
        inventory = str(row.get(inventory_column, "")).strip() if inventory_column is not None else ""
        room_restrictions = restrictions(room, inventory)
        rooms.append({
            "building": str(row.get(building_column, "")).strip() if building_column is not None else "",
            "room": room,
            "capacity": capacity(row.get(capacity_column, "")),
            "features": inventory,
            "restrictions": room_restrictions,
            "planningEligible": not room_restrictions,
            "sourceSection": str(row.get(source_section_column, "")).strip() if source_section_column is not None else "",
        })
    return {"source": source.name, "method": "Capacity and inventory only; no availability schedule was supplied", "rooms": rooms}


def main(source: str, output: str) -> None:
    payload = import_classrooms(Path(source))
    destination = Path(output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text("window.CLASSROOM_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"Wrote {len(payload['rooms'])} classroom inventory rows to {destination}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: import_classrooms.py SOURCE.xlsx classroom-data.js")
    main(sys.argv[1], sys.argv[2])
