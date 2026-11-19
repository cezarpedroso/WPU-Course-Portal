"""Import catalog course descriptions into browser-ready planning data.

The PDF is deliberately treated as the description and offering-pattern source.
Program requirements and term placements continue to come from their own sources.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader


COURSE_START = re.compile(
    r"^([A-Z]{2,6})\s+(\d{3}(?:-\d{3})?[A-Z]{0,3})\s*(?::|–|-)?\s*(.+?)\s*$",
    re.MULTILINE,
)
CREDITS = re.compile(r"\s*(\d+(?:\s*-\s*\d+)?)\s+credits?(?:\s+hours?)?\s*(?:\n|$)", re.IGNORECASE)
OFFERING = re.compile(r"(?:Offered|Typically offered)\b[^.]*\.")
INLINE_CREDITS = re.compile(r"\s+(\d+(?:\s*-\s*\d+)?)\s+credits?(?:\s+hours?)?\s*$", re.IGNORECASE)


def compact(value: str) -> str:
    return " ".join(value.replace("\u00a0", " ").split())


def description_text(raw: str) -> str:
    lines = [compact(line) for line in re.sub(r"\[\[PAGE:\d+\]\]", " ", raw).splitlines()]
    # A departmental heading has no course code or credit line and otherwise
    # becomes part of the preceding course when a description spans pages.
    for index, line in enumerate(lines):
        if index and re.fullmatch(r"[A-Za-z][A-Za-z &'’/.-]+\([A-Z]{2,6}\)", line):
            lines = lines[:index]
            break
    return compact(" ".join(lines))


def page_text(page) -> str:
    text = page.extract_text() or ""
    text = re.sub(r"August \d{4} William Penn University\s+Page \d+ of \d+\s*", "", text)
    lines = []
    for line in text.splitlines():
        normalized = compact(line)
        if re.match(r"^(August \d{4} William Penn University|Page \d+ of \d+)$", normalized):
            continue
        lines.append(line.rstrip())
    return "\n".join(lines)


def headings(text: str):
    """Yield course-heading spans and any immediately following credit line.

    Field-experience entries occasionally have no credit line.  Once the real
    Course Descriptions section is isolated, their heading/body pattern is
    still reliable and should not be discarded.
    """

    for match in COURSE_START.finditer(text):
        title = compact(match.group(3))
        inline_credits = INLINE_CREDITS.search(title)
        if inline_credits:
            yield match, None, compact(title[: inline_credits.start()]), compact(inline_credits.group(1))
        else:
            credit_match = CREDITS.match(text, match.end())
            yield match, credit_match, title, compact(credit_match.group(1)) if credit_match else ""


def catalog_records(pdf_path: Path) -> dict[str, dict[str, str | int]]:
    reader = PdfReader(str(pdf_path))
    pages = []
    started = False
    for number, page in enumerate(reader.pages, start=1):
        text = page_text(page)
        if re.search(r"^\s*Course Descriptions\s*$", text, re.MULTILINE):
            started = True
        if started and re.search(r"^\s*Special Courses\s*$", text, re.MULTILINE):
            break
        if started:
            pages.append((number, text))

    if not pages:
        raise ValueError("Could not find the catalog Course Descriptions section.")

    # The marker makes the original catalog page recoverable after descriptions
    # are joined across PDF page boundaries.
    joined = "\n".join(f"\n[[PAGE:{number}]]\n{text}" for number, text in pages)
    matches = list(headings(joined))
    records: dict[str, dict[str, str | int]] = {}
    for index, (heading, credits, title, credit_text) in enumerate(matches):
        body_end = matches[index + 1][0].start() if index + 1 < len(matches) else len(joined)
        raw_body = joined[credits.end() if credits else heading.end() : body_end]
        page_numbers = [int(value) for value in re.findall(r"\[\[PAGE:(\d+)\]\]", joined[: heading.start()])]
        description = description_text(raw_body)
        code = f"{heading.group(1)} {heading.group(2)}"
        # A matching heading in a later cross-listing is an override only when
        # it has a substantive description.  This avoids replacing a complete
        # entry with a short redirect such as "Same as ...".
        if len(description) < 25:
            continue
        records[code] = {
            "code": code,
            "title": title,
            "credits": credit_text,
            "description": description,
            "offering": compact(" ".join(OFFERING.findall(description))),
            "sourcePage": page_numbers[-1] if page_numbers else None,
        }
    return records


def main(source: str, output: str) -> None:
    source_path = Path(source)
    records = catalog_records(source_path)
    payload = {
        "source": source_path.name,
        "method": "Extracted from the catalog Course Descriptions section",
        "courses": dict(sorted(records.items())),
    }
    destination = Path(output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        "window.WPU_COURSE_CATALOG = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(records)} catalog course records to {destination}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: import_catalog_courses.py CATALOG.pdf course-catalog-data.js")
    main(sys.argv[1], sys.argv[2])
