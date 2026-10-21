"""Simplified Assessment Monitoring Excel export."""

from __future__ import annotations

from datetime import date
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.properties import PageSetupProperties

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


def _write_monitoring_sheet(sheet, month_label: str, items: list[dict]) -> None:
    sheet.sheet_view.showGridLines = False
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.fitToPage = True
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
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

    sheet.merge_cells("A1:H1")
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
        "REMARKS",
    ]
    for col, header in enumerate(headers, start=1):
        cell = sheet.cell(2, col, header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center
        cell.border = thin
    sheet.row_dimensions[2].height = 22
    sheet.auto_filter.ref = f"A2:H{max(3, 2 + len(items))}"
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
            item.get("remarks") or "",
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

    widths = [18, 42, 36, 16, 14, 28, 26, 30]
    for index, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width


def build_monitoring_workbook(year: int, month: int, items: list[dict]) -> BytesIO:
    month_label = date(year, month, 1).strftime("%B %Y")
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = month_label[:31]
    _write_monitoring_sheet(sheet, month_label, items)

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer


def iter_months(start_year: int, start_month: int, end_year: int, end_month: int):
    """Yield (year, month) tuples from the start month through the end month, inclusive."""
    year, month = start_year, start_month
    end_index = end_year * 12 + (end_month - 1)
    while year * 12 + (month - 1) <= end_index:
        yield year, month
        month += 1
        if month > 12:
            month = 1
            year += 1


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    month_start = date(year, month, 1)
    month_end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return month_start, month_end


def bucket_assessments_by_month(
    items: list[dict], months: list[tuple[int, int]]
) -> dict[tuple[int, int], list[dict]]:
    """Place each assessment into exactly one month in `months`: its own start month if that
    month is in range, otherwise the earliest month in range it overlaps. This keeps assessments
    that span a month boundary (e.g. Sept 29 - Oct 2) from being duplicated across both sheets.
    """
    buckets: dict[tuple[int, int], list[dict]] = {key: [] for key in months}
    month_set = set(months)
    for item in items:
        start = parse_iso_date(item["start_date"])
        end = parse_iso_date(item["end_date"])
        start_key = (start.year, start.month)
        if start_key in month_set:
            buckets[start_key].append(item)
            continue
        placed = False
        for key in months:
            month_start, month_end = _month_bounds(*key)
            if start < month_end and end >= month_start:
                buckets[key].append(item)
                placed = True
                break
        if not placed:
            # Assessment doesn't actually overlap the exported range; skip it.
            continue
    return buckets


def build_monitoring_workbook_range(
    start_year: int, start_month: int, end_year: int, end_month: int, items: list[dict]
) -> BytesIO:
    months = list(iter_months(start_year, start_month, end_year, end_month))
    buckets = bucket_assessments_by_month(items, months)

    workbook = Workbook()
    workbook.remove(workbook.active)
    used_titles: set[str] = set()
    for key in months:
        year, month = key
        month_label = date(year, month, 1).strftime("%B %Y")
        title = month_label[:31]
        base_title, suffix = title, 2
        while title in used_titles:
            title = f"{base_title[:28]} ({suffix})"
            suffix += 1
        used_titles.add(title)
        sheet = workbook.create_sheet(title=title)
        month_items = sorted(buckets[key], key=lambda x: x["start_date"])
        _write_monitoring_sheet(sheet, month_label, month_items)

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer


def build_assessor_history_workbook(assessment_log: list[dict], title: str = "Assessor History") -> BytesIO:
    """One worksheet. One table per qualification, each listing its assessments
    oldest-to-newest going down the page. Qualifications are ordered alphabetically.
    """
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Assessor History"[:31]
    sheet.sheet_view.showGridLines = False
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.fitToPage = True
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.page_margins.left = 0.4
    sheet.page_margins.right = 0.4

    title_fill = PatternFill("solid", fgColor="1F4E79")
    qual_fill = PatternFill("solid", fgColor="0F766E")
    header_fill = PatternFill("solid", fgColor="FFC000")
    zebra = PatternFill("solid", fgColor="FFF2CC")
    thin = Border(
        left=Side(style="thin", color="7F7F7F"),
        right=Side(style="thin", color="7F7F7F"),
        top=Side(style="thin", color="7F7F7F"),
        bottom=Side(style="thin", color="7F7F7F"),
    )
    title_font = Font(name="Calibri", size=16, bold=True, color="FFFFFF")
    qual_font = Font(name="Calibri", size=12, bold=True, color="FFFFFF")
    header_font = Font(name="Calibri", size=11, bold=True)
    body_font = Font(name="Calibri", size=11)
    wrap = Alignment(wrap_text=True, vertical="center")
    center = Alignment(wrap_text=True, vertical="center", horizontal="center")

    headers = ["Assessor(s)", "Assessment Center", "Date", "Pax", "TESDA Representative"]
    widths = [36, 36, 18, 10, 26]

    grouped: dict[str, list[dict]] = {}
    for item in assessment_log:
        grouped.setdefault(item.get("qualification") or "Unspecified Qualification", []).append(item)
    for entries in grouped.values():
        entries.sort(key=lambda x: x["start_date"])  # oldest -> newest, top to bottom
    ordered_qualifications = sorted(grouped.keys(), key=str.casefold)

    row = 1
    sheet.merge_cells(start_row=row, start_column=1, end_row=row, end_column=len(headers))
    title_cell = sheet.cell(row, 1, title.upper())
    title_cell.fill = title_fill
    title_cell.font = title_font
    title_cell.alignment = Alignment(horizontal="left", vertical="center")
    sheet.row_dimensions[row].height = 28
    row += 2

    if not ordered_qualifications:
        sheet.cell(row, 1, "No recorded assessments.").font = body_font
    else:
        for qualification in ordered_qualifications:
            entries = grouped[qualification]
            sheet.merge_cells(start_row=row, start_column=1, end_row=row, end_column=len(headers))
            qual_cell = sheet.cell(
                row, 1, f"{qualification}  ({len(entries)} assessment{'s' if len(entries) != 1 else ''})"
            )
            qual_cell.fill = qual_fill
            qual_cell.font = qual_font
            qual_cell.alignment = Alignment(horizontal="left", vertical="center")
            sheet.row_dimensions[row].height = 24
            row += 1

            for col, header in enumerate(headers, start=1):
                cell = sheet.cell(row, col, header)
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = center
                cell.border = thin
            sheet.row_dimensions[row].height = 20
            row += 1

            for index, item in enumerate(entries):
                assessor_names = "; ".join(
                    f"{a['name']} ({'Region' if a.get('assessor_type') == 'region' else 'Province'})"
                    for a in item.get("assessors") or []
                )
                values = [
                    assessor_names,
                    item.get("assessment_center") or "",
                    item.get("date_label") or "",
                    item.get("pax") or "",
                    item.get("tesda_representative") or "",
                ]
                fill = zebra if index % 2 else None
                for col, value in enumerate(values, start=1):
                    cell = sheet.cell(row, col, value)
                    cell.font = body_font
                    cell.alignment = center if col in {3, 4} else wrap
                    cell.border = thin
                    if fill:
                        cell.fill = fill
                sheet.row_dimensions[row].height = 30
                row += 1
            row += 1  # spacer row between qualification tables

    for index, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer
