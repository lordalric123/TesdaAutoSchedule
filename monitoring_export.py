"""Simplified Assessment Monitoring Excel export."""

from __future__ import annotations

from datetime import date
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.properties import PageSetupProperties

from date_rules import parse_iso_date

TITLE_FILL = PatternFill("solid", fgColor="1F4E79")
SECTION_FILL = PatternFill("solid", fgColor="0F766E")
HEADER_FILL = PatternFill("solid", fgColor="FFC000")
ZEBRA_FILL = PatternFill("solid", fgColor="FFF2CC")
THIN_BORDER = Border(
    left=Side(style="thin", color="7F7F7F"),
    right=Side(style="thin", color="7F7F7F"),
    top=Side(style="thin", color="7F7F7F"),
    bottom=Side(style="thin", color="7F7F7F"),
)
TITLE_FONT = Font(name="Calibri", size=16, bold=True, color="FFFFFF")
SECTION_FONT = Font(name="Calibri", size=12, bold=True, color="FFFFFF")
HEADER_FONT = Font(name="Calibri", size=11, bold=True)
BODY_FONT = Font(name="Calibri", size=11)
WRAP_ALIGN = Alignment(wrap_text=True, vertical="center")
CENTER_ALIGN = Alignment(wrap_text=True, vertical="center", horizontal="center")


def _make_print_ready(sheet, repeat_rows: str | None = None, paper_size=None) -> None:
    """Apply the page setup needed for a sheet to print correctly straight out of
    Excel with no manual adjustment: landscape, fit to one page wide (with the
    fitToPage flag Excel actually reads — setting page_setup alone is not enough),
    centered on the page, tight margins, and the header row repeating on every
    printed page when the sheet runs longer than one page.
    """
    sheet.sheet_view.showGridLines = False
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    if paper_size:
        sheet.page_setup.paperSize = paper_size
    # This is the part that's easy to miss: Excel ignores page_setup.fitToWidth /
    # fitToHeight unless sheet_properties.pageSetUpPr.fitToPage is also set. Without
    # it, the sheet opens looking like fit-to-page was never configured at all.
    sheet.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    sheet.page_margins.left = 0.4
    sheet.page_margins.right = 0.4
    sheet.page_margins.top = 0.5
    sheet.page_margins.bottom = 0.5
    sheet.print_options.horizontalCentered = True
    if repeat_rows:
        sheet.print_title_rows = repeat_rows


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


def _populate_monitoring_sheet(sheet, month_label: str, items: list[dict]) -> None:
    _make_print_ready(sheet, repeat_rows="2:2", paper_size=sheet.PAPERSIZE_LEGAL)

    sheet.merge_cells("A1:G1")
    title = sheet["A1"]
    title.value = f"ASSESSMENT SCHEDULES FOR {month_label.upper()}"
    title.fill = TITLE_FILL
    title.font = TITLE_FONT
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
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = CENTER_ALIGN
        cell.border = THIN_BORDER
    sheet.row_dimensions[2].height = 22
    sheet.auto_filter.ref = f"A2:G{max(3, 2 + len(items))}"
    sheet.freeze_panes = "A3"
    sheet.print_area = f"A1:G{max(3, 2 + len(items))}"

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
        fill = ZEBRA_FILL if index % 2 else None
        for col, value in enumerate(values, start=1):
            cell = sheet.cell(row, col, value)
            cell.font = BODY_FONT
            cell.alignment = CENTER_ALIGN if col in {1, 4, 5} else WRAP_ALIGN
            cell.border = THIN_BORDER
            if fill:
                cell.fill = fill
        line_count = max(1, assessor_text.count("\n") + 1)
        sheet.row_dimensions[row].height = max(32, 16 * line_count + 16)

    widths = [18, 42, 36, 16, 14, 28, 26]
    for index, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width


def build_monitoring_workbook(year: int, month: int, items: list[dict]) -> BytesIO:
    month_label = date(year, month, 1).strftime("%B %Y")
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = month_label[:31]
    _populate_monitoring_sheet(sheet, month_label, items)

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer


def build_monitoring_workbook_range(months: list[tuple[int, int, list[dict]]]) -> BytesIO:
    """Same print-ready layout as build_monitoring_workbook, but one sheet per
    month, all in a single workbook — for exporting a range of months at once.
    `months` is a list of (year, month, items) tuples, already in the order the
    sheets should appear.
    """
    workbook = Workbook()
    first = True
    for year, month, items in months:
        month_label = date(year, month, 1).strftime("%B %Y")
        sheet = workbook.active if first else workbook.create_sheet()
        first = False
        sheet.title = month_label[:31]
        _populate_monitoring_sheet(sheet, month_label, items)

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
    _make_print_ready(sheet)

    title_fill, qual_fill, header_fill, zebra = TITLE_FILL, SECTION_FILL, HEADER_FILL, ZEBRA_FILL
    thin = THIN_BORDER
    title_font, qual_font, header_font, body_font = TITLE_FONT, SECTION_FONT, HEADER_FONT, BODY_FONT
    wrap, center = WRAP_ALIGN, CENTER_ALIGN

    headers = ["Date", "Assessment Center", "Assessor(s)", "Pax", "TESDA Representative"]
    widths = [18, 36, 36, 10, 26]

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
                    item.get("date_label") or "",
                    item.get("assessment_center") or "",
                    assessor_names,
                    item.get("pax") or "",
                    item.get("tesda_representative") or "",
                ]
                fill = zebra if index % 2 else None
                for col, value in enumerate(values, start=1):
                    cell = sheet.cell(row, col, value)
                    cell.font = body_font
                    cell.alignment = center if col in {1, 4} else wrap
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


def _write_assessor_sheet(
    sheet,
    qualification: str,
    rows: list[dict],
    include_type: bool,
) -> None:
    """Fill one sheet with a print-ready table of assessors for a qualification.
    include_type adds a Type column (Province-Based/Region-Based) — used for the
    combined "Both" sheet where the two groups are mixed together.
    """
    _make_print_ready(sheet, repeat_rows="2:2")

    headers = ["Name"]
    if include_type:
        headers.append("Type")
    headers += ["Sex", "Address", "Designation", "Company / Employer", "Sector", "Accreditation No.", "Valid Until"]

    sheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(headers))
    title_cell = sheet.cell(1, 1, f"{qualification.upper()} — ASSESSORS")
    title_cell.fill = TITLE_FILL
    title_cell.font = TITLE_FONT
    title_cell.alignment = Alignment(horizontal="left", vertical="center")
    sheet.row_dimensions[1].height = 28

    for col, header in enumerate(headers, start=1):
        cell = sheet.cell(2, col, header)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = CENTER_ALIGN
        cell.border = THIN_BORDER
    sheet.row_dimensions[2].height = 22
    last_row = max(3, 2 + len(rows))
    sheet.auto_filter.ref = f"A2:{get_column_letter(len(headers))}{last_row}"
    sheet.freeze_panes = "A3"
    sheet.print_area = f"A1:{get_column_letter(len(headers))}{last_row}"

    sorted_rows = sorted(rows, key=lambda r: (r.get("display_name") or r.get("name") or "").casefold())
    for index, person in enumerate(sorted_rows):
        row = 3 + index
        values = [person.get("display_name") or person.get("name") or ""]
        if include_type:
            values.append("Region-Based" if person.get("assessor_type") == "region" else "Province-Based")
        values += [
            person.get("sex") or "",
            person.get("address") or "",
            person.get("designation") or "",
            person.get("company") or "",
            person.get("sector") or "",
            person.get("accreditation_number") or "",
            person.get("valid_until") or "",
        ]
        fill = ZEBRA_FILL if index % 2 else None
        for col, value in enumerate(values, start=1):
            cell = sheet.cell(row, col, value)
            cell.font = BODY_FONT
            cell.alignment = CENTER_ALIGN if col in ({2, 3} if include_type else {2}) else WRAP_ALIGN
            cell.border = THIN_BORDER
            if fill:
                cell.fill = fill
        sheet.row_dimensions[row].height = 26

    if not rows:
        empty_cell = sheet.cell(3, 1, "No assessors on record for this qualification.")
        empty_cell.font = BODY_FONT

    name_width = 28
    widths = [name_width]
    if include_type:
        widths.append(16)
    widths += [8, 34, 24, 24, 16, 18, 14]
    for index, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width


def build_finder_workbook(
    qualification: str,
    province_assessors: list[dict],
    region_assessors: list[dict],
) -> BytesIO:
    """Three print-ready sheets for one qualification: Province Based Assessors,
    Region Based Assessors, and Both (combined, with a Type column to tell them apart).
    """
    workbook = Workbook()

    sheet_province = workbook.active
    sheet_province.title = "Province Based Assessors"[:31]
    _write_assessor_sheet(sheet_province, qualification, province_assessors, include_type=False)

    sheet_region = workbook.create_sheet("Region Based Assessors"[:31])
    _write_assessor_sheet(sheet_region, qualification, region_assessors, include_type=False)

    sheet_both = workbook.create_sheet("Both"[:31])
    _write_assessor_sheet(sheet_both, qualification, province_assessors + region_assessors, include_type=True)

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer
