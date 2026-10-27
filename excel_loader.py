"""Load TESDA assessor and assessment-center Excel registries dynamically."""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

import pandas as pd


REQUIRED_CENTER_COLUMNS = [
    "ASSESSMENT CENTER",
    "QUALIFICATION TITLE",
]
REQUIRED_ASSESSOR_COLUMNS = [
    "NAME",
    "QUALIFICATION TITLE",
]


def normalize_text(value) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    text = str(value).replace("\xa0", " ").strip()
    text = re.sub(r"\s+", " ", text)
    return text


def normalize_key(value) -> str:
    return normalize_text(value).casefold()


def identity_key(name: str, accreditation: str = "", birth: str = "", address: str = "") -> str:
    """Identify one person without merging unrelated people who share a name.

    Name + birthdate (or, failing that, name + address) is preferred over the
    accreditation number: a person's date of birth stays the same across every
    row of theirs in the sheet, but their accreditation number does not — it's
    assigned per qualification, so an assessor accredited for several
    qualifications has a different number on each of their rows. Keying on
    accreditation first would read that as several different people instead
    of one person with several qualifications. Accreditation number is kept
    as a fallback for when there's no birthdate or address to go on at all.
    """
    name_key = normalize_key(name)
    acc = normalize_key(accreditation)
    dob = normalize_key(birth)
    addr = normalize_key(address)
    if name_key and dob:
        return f"name-dob:{name_key}|{dob}"
    if name_key and addr:
        return f"name-addr:{name_key}|{addr}"
    if acc:
        return f"acc:{acc}"
    return f"name:{name_key}"


def _stringify(value) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    if text.lower() in {"nan", "nat", "none", "n/a", "na"}:
        return ""
    return text


def _stringify_date(value) -> str:
    """Like _stringify, but for date-ish columns (birthdate, valid-until, date accredited).
    Excel sometimes stores these as real dates and sometimes as free text (e.g. "12/31/2026",
    "Dec 31 2026"); normalize whatever is parseable to ISO so the UI can format it, and fall
    back to the original text (e.g. "Lifetime") when it genuinely isn't a date.
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    if not text or text.lower() in {"nan", "nat", "none", "n/a", "na"}:
        return ""
    try:
        parsed = pd.to_datetime(text, errors="raise")
    except (ValueError, TypeError):
        return text
    if pd.isna(parsed):
        return text
    return parsed.strftime("%Y-%m-%d")


def _raw_fields(row: pd.Series, exclude: tuple[str, ...] = ()) -> list[list[str]]:
    """Every column from the source Excel row, verbatim and in the file's own
    column order — so the UI can show the complete record exactly as it appears
    in the file it originated from, not just the handful of fields this app
    otherwise curates. Date-ish columns (anything with DATE, VALID, EXPIR, or
    BIRTH in the header) are normalized the same way the known date fields are.
    """
    exclude_set = {e.upper() for e in exclude}
    fields: list[list[str]] = []
    for col in row.index:
        header = str(col).strip()
        if not header or header.upper() in exclude_set:
            continue
        upper = header.upper()
        if any(hint in upper for hint in ("DATE", "VALID", "EXPIR", "BIRTH")):
            value = _stringify_date(row.get(col))
        else:
            value = _stringify(row.get(col))
        if value:
            fields.append([header, value])
    return fields


def _read_excel(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Excel file not found: {path}")
    try:
        df = pd.read_excel(path, engine="calamine")
    except Exception:
        df = pd.read_excel(path)
    df.columns = [normalize_text(col).upper() for col in df.columns]
    return df


def _validate(df: pd.DataFrame, required: list[str], label: str) -> None:
    missing = [col for col in required if col not in df.columns]
    if missing:
        raise ValueError(
            f"{label} is missing required column(s): {', '.join(missing)}. "
            f"Found columns: {', '.join(df.columns)}"
        )


def _load_assessor_file(path: Path | None, source: str, label: str) -> list[dict]:
    if path is None or not str(path).strip() or not Path(path).exists():
        return []
    df = _read_excel(Path(path))
    _validate(df, REQUIRED_ASSESSOR_COLUMNS, label)
    rows = [_assessor_record(row, source) for _, row in df.iterrows()]
    return [row for row in rows if row["name"] and row["qualification"]]


class ExcelRegistry:
    def __init__(self) -> None:
        self.centers_path: Path | None = None
        self.province_assessors_path: Path | None = None
        self.region_assessors_path: Path | None = None
        self.center_rows: list[dict] = []
        self.province_rows: list[dict] = []
        self.region_rows: list[dict] = []
        self.error: str | None = None
        self.loaded_at: str | None = None

    @property
    def assessor_rows(self) -> list[dict]:
        return self.province_rows + self.region_rows

    def load(
        self,
        centers_path: str | Path,
        province_assessors_path: str | Path,
        region_assessors_path: str | Path | None = None,
    ) -> None:
        self.centers_path = Path(centers_path)
        self.province_assessors_path = Path(province_assessors_path) if province_assessors_path else None
        self.region_assessors_path = Path(region_assessors_path) if region_assessors_path else None
        self.error = None
        try:
            centers_df = _read_excel(self.centers_path)
            _validate(centers_df, REQUIRED_CENTER_COLUMNS, "Assessment Centers Excel")
            self.center_rows = [_center_record(row) for _, row in centers_df.iterrows()]
            self.center_rows = [r for r in self.center_rows if r["center"] and r["qualification"]]
            self.province_rows = _load_assessor_file(
                self.province_assessors_path,
                "province",
                "Province-Based Competency Assessors Excel",
            )
            try:
                self.region_rows = _load_assessor_file(
                    self.region_assessors_path,
                    "region",
                    "Region-Based Competency Assessors Excel",
                )
            except FileNotFoundError:
                self.region_rows = []
            self.loaded_at = datetime.now().isoformat(timespec="seconds")
        except Exception as exc:
            self.error = str(exc)
            raise

    def summary(self) -> dict:
        return {
            "centers_file": str(self.centers_path) if self.centers_path else "",
            "centers_file_name": self.centers_path.name if self.centers_path else "",
            "province_assessors_file": str(self.province_assessors_path) if self.province_assessors_path else "",
            "province_assessors_file_name": self.province_assessors_path.name if self.province_assessors_path else "",
            "region_assessors_file": str(self.region_assessors_path) if self.region_assessors_path else "",
            "region_assessors_file_name": (
                self.region_assessors_path.name
                if self.region_assessors_path and self.region_assessors_path.exists()
                else ""
            ),
            "assessors_file": str(self.province_assessors_path) if self.province_assessors_path else "",
            "assessors_file_name": self.province_assessors_path.name if self.province_assessors_path else "",
            "center_records": len(self.center_rows),
            "province_assessor_records": len(self.province_rows),
            "region_assessor_records": len(self.region_rows),
            "assessor_records": len(self.assessor_rows),
            "unique_centers": len({row["center_key"] for row in self.center_rows}),
            "unique_province_assessors": len({row["identity_key"] for row in self.province_rows}),
            "unique_region_assessors": len({row["identity_key"] for row in self.region_rows}),
            "unique_assessors": len({row["identity_key"] for row in self.assessor_rows}),
            "loaded_at": self.loaded_at,
            "error": self.error,
        }

    def assessment_centers(self) -> list[dict]:
        grouped: dict[str, dict] = {}
        for row in self.center_rows:
            item = grouped.setdefault(
                row["center_key"],
                {
                    "name": row["center"],
                    "address": row["address"],
                    "manager": row["manager"],
                    "telephone": row["telephone"],
                    "sector": row["sector"],
                    "qualifications": [],
                },
            )
            if row["qualification"] not in item["qualifications"]:
                item["qualifications"].append(row["qualification"])
        for item in grouped.values():
            item["qualifications"].sort(key=str.casefold)
        return sorted(grouped.values(), key=lambda x: x["name"].casefold())

    def qualifications_for_center(self, center: str) -> list[str]:
        key = normalize_key(center)
        quals = sorted(
            {row["qualification"] for row in self.center_rows if row["center_key"] == key},
            key=str.casefold,
        )
        return quals

    def assessors(self, qualification: str | None = None, source: str | None = None) -> list[dict]:
        rows = self._rows_for_source(source)
        return _group_assessors(rows, qualification)

    def all_qualifications(self) -> list[str]:
        quals = {row["qualification"] for row in self.center_rows}
        quals.update(row["qualification"] for row in self.assessor_rows)
        return sorted(quals, key=str.casefold)

    def find_qualification(self, query: str) -> list[str]:
        needle = normalize_key(query)
        if not needle:
            return self.all_qualifications()
        return [q for q in self.all_qualifications() if needle in normalize_key(q)]

    def finder(self, qualification: str, source: str | None = None) -> dict:
        key = normalize_key(qualification)
        rows = self._rows_for_source(source)
        assessors = _group_assessors(rows, qualification)
        centers: dict[str, dict] = {}
        for row in self.center_rows:
            if row["qualification_key"] != key:
                continue
            centers.setdefault(
                row["center_key"],
                {
                    "name": row["center"],
                    "address": row["address"],
                    "manager": row["manager"],
                    "telephone": row["telephone"],
                    "sector": row["sector"],
                    "accreditation_number": row["accreditation_number"],
                    "valid_until": row["valid_until"],
                },
            )

        display = qualification
        for source in (self.center_rows, self.assessor_rows):
            match = next((row["qualification"] for row in source if row["qualification_key"] == key), None)
            if match:
                display = match
                break

        return {
            "qualification": display,
            "assessors": assessors,
            "centers": sorted(centers.values(), key=lambda x: x["name"].casefold()),
        }

    def _rows_for_source(self, source: str | None) -> list[dict]:
        if source == "region":
            return self.region_rows
        if source == "province":
            return self.province_rows
        return self.assessor_rows


def _group_assessors(rows: list[dict], qualification: str | None = None) -> list[dict]:
    grouped: dict[str, dict] = {}
    target = normalize_key(qualification) if qualification else None
    for row in rows:
        if target and row["qualification_key"] != target:
            continue
        item = grouped.setdefault(
            row["identity_key"],
            {
                "name": row["name"],
                "display_name": row["name"],
                "identity_key": row["identity_key"],
                "assessor_type": row["source"],
                "sources": [],
                "region": row["region"],
                "province": row["province"],
                "address": row["address"],
                "sex": row["sex"],
                "date_of_birth": row["date_of_birth"],
                "designation": row["designation"],
                "company": row["company"],
                "sector": row["sector"],
                "accreditation_number": row["accreditation_number"],
                "valid_until": row["valid_until"],
                "raw_fields": row["raw_fields"],
                "qualifications": [],
                # One entry per (qualification, source) this person is accredited for —
                # keyed by source as well as title, not just title, so a qualification
                # held under both the province and region sheets keeps both accreditation
                # records instead of the second one silently overwriting/skipping the
                # first. Each entry has its own accreditation number / expiry, since the
                # same assessor is often accredited on different dates/numbers per source.
                "qualification_details": [],
            },
        )
        # A person listed under both the province and region sheets is shown as a
        # province-based assessor first — province always takes priority over region
        # when both are present, regardless of which row happened to be read first.
        if row["source"] == "province":
            item["assessor_type"] = "province"
        if row["source"] not in item["sources"]:
            item["sources"].append(row["source"])
        qual_detail_seen = {(d["qualification"], d.get("source")) for d in item["qualification_details"]}
        if (row["qualification"], row["source"]) not in qual_detail_seen:
            item["qualification_details"].append(
                {
                    "qualification": row["qualification"],
                    "source": row["source"],
                    "accreditation_number": row["accreditation_number"],
                    "valid_until": row["valid_until"],
                    "raw_fields": row["raw_fields"],
                }
            )
        if row["qualification"] not in item["qualifications"]:
            item["qualifications"].append(row["qualification"])
        # Same province-first priority for which record supplies the top-level
        # accreditation/raw-field summary: take whatever's there first, but a
        # province row always overrides a region-sourced one if that's what's
        # currently shown, not just whichever happened to load first.
        has_accred = bool(item["accreditation_number"])
        shown_is_province = item.get("_accred_source") == "province"
        if row["accreditation_number"] and (not has_accred or (row["source"] == "province" and not shown_is_province)):
            item["accreditation_number"] = row["accreditation_number"]
            item["valid_until"] = row["valid_until"]
            item["raw_fields"] = row["raw_fields"]
            item["_accred_source"] = row["source"]
        if not item["region"] and row["region"]:
            item["region"] = row["region"]
        if not item["province"] and row["province"]:
            item["province"] = row["province"]
        if not item["date_of_birth"] and row["date_of_birth"]:
            item["date_of_birth"] = row["date_of_birth"]

    name_counts: dict[str, int] = {}
    for item in grouped.values():
        name_counts[item["name"].casefold()] = name_counts.get(item["name"].casefold(), 0) + 1
    for item in grouped.values():
        if name_counts[item["name"].casefold()] > 1:
            extra = item["accreditation_number"] or item["address"]
            if extra:
                item["display_name"] = f"{item['name']} ({extra})"
        item["qualifications"].sort(key=str.casefold)
        # Province entries first within each qualification title, so a qualification
        # held under both sheets lists its province accreditation before its region one.
        item["qualification_details"].sort(
            key=lambda d: (d["qualification"].casefold(), d.get("source") != "province")
        )
        item.pop("_accred_source", None)
    return sorted(grouped.values(), key=lambda x: x["display_name"].casefold())


def _center_record(row: pd.Series) -> dict:
    center = normalize_text(row.get("ASSESSMENT CENTER"))
    qualification = normalize_text(row.get("QUALIFICATION TITLE"))
    return {
        "region": _stringify(row.get("REGION")),
        "province": _stringify(row.get("PROVINCE")),
        "center": center,
        "center_key": normalize_key(center),
        "address": _stringify(row.get("ADDRESS")),
        "manager": _stringify(row.get("CENTER MANAGER")),
        "telephone": _stringify(row.get("TEL. NO.")),
        "sector": _stringify(row.get("SECTOR")),
        "qualification": qualification,
        "qualification_key": normalize_key(qualification),
        "accreditation_number": _stringify(row.get("ACCREDITATION NUMBER")),
        "date_accredited": _stringify_date(row.get("DATE ACCREDITED")),
        "valid_until": _stringify_date(row.get("VALID UNTIL")),
        "raw_fields": _raw_fields(row, exclude=("ASSESSMENT CENTER", "QUALIFICATION TITLE")),
    }


def _assessor_record(row: pd.Series, source: str) -> dict:
    name = normalize_text(row.get("NAME"))
    qualification = normalize_text(row.get("QUALIFICATION TITLE"))
    accreditation = _stringify(row.get("ACCREDITATION NUMBER"))
    birth = _stringify_date(row.get("DATE OF BIRTH"))
    address = _stringify(row.get("ADDRESS"))
    return {
        "source": source,
        "region": _stringify(row.get("REGION")),
        "province": _stringify(row.get("PROVINCE")),
        "name": name,
        "name_key": normalize_key(name),
        "identity_key": identity_key(name, accreditation, birth, address),
        "address": address,
        "sex": _stringify(row.get("SEX")),
        "date_of_birth": birth,
        "designation": _stringify(row.get("PRESENT DESIGNATION")),
        "company": _stringify(row.get("COMPANY NAME")),
        "sector": _stringify(row.get("SECTOR")),
        "qualification": qualification,
        "qualification_key": normalize_key(qualification),
        "accreditation_number": accreditation,
        "valid_until": _stringify_date(row.get("VALID UNTIL")),
        "raw_fields": _raw_fields(row, exclude=("NAME", "QUALIFICATION TITLE")),
    }
