"""Simplified Assessment Monitoring Excel export."""

from __future__ import annotations

from datetime import date
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from date_rules import parse_iso_date


def compact_day_span(start: date, end: date) -> str:
    if start == end:
        return str(start.day)
    if start.month == end.month and start.year == end.year:
        return f"{start.day}-{end.day}"
    if start.year == end.year:
        return f"{start.month}/{start.day}-{end.month}/{end.day}"
    return f"{start.month}/{start.day}/{start.year}-{end.month}/{end.day}/{end.year}"


def compact_assessors(assessors: list[dict]) -> str:
    if not assessors:
        return ""
    labels = [
        f"{a.get('name', '')} ({'Region' if a.get('assessor_type') == 'region' else 'Province'})"
        for a in assessors
        if a.get("name")
    ]
    return "\n".join(labels)


def compact_approved_dates(iso_dates: list[str]) -> str:
    if not iso_dates:
        return ""
    parsed = sorted({parse_iso_date(value) for value in iso_dates})
    first, last = parsed[0], parsed[-1]
    if first == last:
        return f"{first.month}/{first.day}/{first.year}"
    if first.month == last.month and first.year == last.year:
        return f"{first.month}/{first.day}-{last.day}/{last.year}"
    if first.year == last.year:
        return f"{first.month}/{first.day}-{last.month}/{last.day}, {last.year}"
    return f"{first.month}/{first.day}/{first.year}-{last.month}/{last.day}/{last.year}"


def build_monitoring_workbook(year: int, month: int, items: list[dict]) -> BytesIO:
    month_label = date(year, month, 1).strftime("%B %Y")
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = month_label[:31]
    sheet.sheet_view.showGridLines = False
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.fitToPage = True
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.page_setup.paperSize = sheet.PAPERSIZE_LEGAL
    sheet.page_margins.left = 0.4
    sheet.page_margins.right = 0.4

    title_fill = PatternFill("solid", fgColor="1F4E79")
    header_fill = PatternFill("solid", fgColor="FFC000")
    zebra = PatternFill("solid", fgColor="FFF2CC")
    thin = Border(
        left=Side(style="thin", color="7F7F7F"),
        right=Side(style="thin", color="7F7F7F"),
        top=Side(style="thin", color="7F7F7F"),
        bottom=Side(style="thin", color="7F7F7F"),
    )
    title_font = Font(name="Calibri", size=16, bold=True, color="FFFFFF")
    header_font = Font(name="Calibri", size=11, bold=True)
    body_font = Font(name="Calibri", size=11)
    wrap = Alignment(wrap_text=True, vertical="center")
    center = Alignment(wrap_text=True, vertical="center", horizontal="center")

    sheet.merge_cells("A1:G1")
    title = sheet["A1"]
    title.value = f"ASSESSMENT SCHEDULES FOR {month_label.upper()}"
    title.fill = title_fill
    title.font = title_font
    title.alignment = Alignment(horizontal="left", vertical="center")
    sheet.row_dimensions[1].height = 28

    headers = [
        "APPROVED DATES",
        "ASSESSMENT CENTERS",
        "QUALIFICATIONS",
        "ASSESSMENT DATE",
        "NUMBER OF PAX",
        "ASSESSOR",
        "TESDA REPRESENTATIVE",
    ]
    for col, header in enumerate(headers, start=1):
        cell = sheet.cell(2, col, header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center
        cell.border = thin
    sheet.row_dimensions[2].height = 22
    sheet.auto_filter.ref = f"A2:G{max(3, 2 + len(items))}"
    sheet.freeze_panes = "A3"

    for index, item in enumerate(items):
        row = 3 + index
        start = parse_iso_date(item["start_date"])
        end = parse_iso_date(item["end_date"])
        assessor_text = compact_assessors(item.get("assessors") or [])
        values = [
            compact_approved_dates(item.get("approved_date_list") or []),
            item.get("assessment_center") or "",
            item.get("qualification") or "",
            compact_day_span(start, end),
            item.get("pax") or "",
            assessor_text,
            item.get("tesda_representative") or "",
        ]
        fill = zebra if index % 2 else None
        for col, value in enumerate(values, start=1):
            cell = sheet.cell(row, col, value)
            cell.font = body_font
            cell.alignment = center if col in {1, 4, 5} else wrap
            cell.border = thin
            if fill:
                cell.fill = fill
        line_count = max(1, assessor_text.count("\n") + 1)
        sheet.row_dimensions[row].height = max(32, 16 * line_count + 16)

    widths = [18, 42, 36, 16, 14, 28, 26]
    for index, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer
