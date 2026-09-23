"""Load TESDA assessor and assessment-center Excel registries dynamically."""

from __future__ import annotations

import json
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
    """Identify one person without merging unrelated people who share a name."""
    name_key = normalize_key(name)
    acc = normalize_key(accreditation)
    dob = normalize_key(birth)
    addr = normalize_key(address)
    if acc:
        return f"acc:{acc}"
    if name_key and dob:
        return f"name-dob:{name_key}|{dob}"
    if name_key and addr:
        return f"name-addr:{name_key}|{addr}"
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


def _read_excel(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Excel file not found: {path}")
    try:
        df = pd.read_excel(path, engine="calamine")
    except Exception:
        df = pd.read_excel(path)
    df.columns = [normalize_text(col).upper() for col in df.columns]
    return df


def _read_json_records(path: Path) -> list[dict]:
    if not path.exists():
        raise FileNotFoundError(f"JSON data file not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, list):
        raise ValueError(f"JSON registry file must be a list of records: {path}")
    return [dict(item) for item in payload if isinstance(item, dict)]


def export_registry_to_json(excel_dir: Path, output_dir: Path | None = None) -> dict[str, Path]:
    """Convert the shipped Excel registries into JSON so they can be reused across deployments."""
    source_dir = Path(excel_dir)
    target_dir = Path(output_dir) if output_dir else source_dir
    target_dir.mkdir(parents=True, exist_ok=True)

    output = {}
    centers_path = source_dir / "assessment_centers.xlsx"
    province_path = source_dir / "competency_assessors.xlsx"
    region_path = source_dir / "region_assessors.xlsx"

    if centers_path.exists():
        centers_df = _read_excel(centers_path)
        rows = [_center_record(row) for _, row in centers_df.iterrows()]
        export_path = target_dir / "assessment_centers.json"
        export_path.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
        output["centers"] = export_path

    if province_path.exists():
        province_df = _read_excel(province_path)
        rows = [_assessor_record(row, "province") for _, row in province_df.iterrows()]
        export_path = target_dir / "competency_assessors.json"
        export_path.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
        output["province"] = export_path

    if region_path.exists():
        region_df = _read_excel(region_path)
        rows = [_assessor_record(row, "region") for _, row in region_df.iterrows()]
        export_path = target_dir / "region_assessors.json"
        export_path.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
        output["region"] = export_path

    return output


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
            if self.centers_path.suffix.lower() == ".json":
                centers_rows = _read_json_records(self.centers_path)
                self.center_rows = [
                    {
                        "region": row.get("region", ""),
                        "province": row.get("province", ""),
                        "center": row.get("center", ""),
                        "center_key": row.get("center_key", normalize_key(row.get("center", ""))),
                        "address": row.get("address", ""),
                        "manager": row.get("manager", ""),
                        "telephone": row.get("telephone", ""),
                        "sector": row.get("sector", ""),
                        "qualification": row.get("qualification", ""),
                        "qualification_key": row.get("qualification_key", normalize_key(row.get("qualification", ""))),
                        "accreditation_number": row.get("accreditation_number", ""),
                        "date_accredited": row.get("date_accredited", ""),
                        "valid_until": row.get("valid_until", ""),
                    }
                    for row in centers_rows
                ]
            else:
                centers_df = _read_excel(self.centers_path)
                _validate(centers_df, REQUIRED_CENTER_COLUMNS, "Assessment Centers Excel")
                self.center_rows = [_center_record(row) for _, row in centers_df.iterrows()]
            self.center_rows = [r for r in self.center_rows if r["center"] and r["qualification"]]

            if self.province_assessors_path and self.province_assessors_path.suffix.lower() == ".json":
                self.province_rows = _read_json_records(self.province_assessors_path)
                self.province_rows = [
                    {
                        "source": row.get("source", "province"),
                        "region": row.get("region", ""),
                        "province": row.get("province", ""),
                        "name": row.get("name", ""),
                        "name_key": row.get("name_key", normalize_key(row.get("name", ""))),
                        "identity_key": row.get("identity_key", identity_key(row.get("name", ""), row.get("accreditation_number", ""), row.get("date_of_birth", ""), row.get("address", ""))),
                        "address": row.get("address", ""),
                        "sex": row.get("sex", ""),
                        "date_of_birth": row.get("date_of_birth", ""),
                        "designation": row.get("designation", ""),
                        "company": row.get("company", ""),
                        "sector": row.get("sector", ""),
                        "qualification": row.get("qualification", ""),
                        "qualification_key": row.get("qualification_key", normalize_key(row.get("qualification", ""))),
                        "accreditation_number": row.get("accreditation_number", ""),
                        "valid_until": row.get("valid_until", ""),
                    }
                    for row in _read_json_records(self.province_assessors_path)
                ]
            else:
                self.province_rows = _load_assessor_file(
                    self.province_assessors_path,
                    "province",
                    "Province-Based Competency Assessors Excel",
                )
            try:
                if self.region_assessors_path and self.region_assessors_path.suffix.lower() == ".json":
                    self.region_rows = [
                        {
                            "source": row.get("source", "region"),
                            "region": row.get("region", ""),
                            "province": row.get("province", ""),
                            "name": row.get("name", ""),
                            "name_key": row.get("name_key", normalize_key(row.get("name", ""))),
                            "identity_key": row.get("identity_key", identity_key(row.get("name", ""), row.get("accreditation_number", ""), row.get("date_of_birth", ""), row.get("address", ""))),
                            "address": row.get("address", ""),
                            "sex": row.get("sex", ""),
                            "date_of_birth": row.get("date_of_birth", ""),
                            "designation": row.get("designation", ""),
                            "company": row.get("company", ""),
                            "sector": row.get("sector", ""),
                            "qualification": row.get("qualification", ""),
                            "qualification_key": row.get("qualification_key", normalize_key(row.get("qualification", ""))),
                            "accreditation_number": row.get("accreditation_number", ""),
                            "valid_until": row.get("valid_until", ""),
                        }
                        for row in _read_json_records(self.region_assessors_path)
                    ]
                else:
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
                "address": row["address"],
                "sex": row["sex"],
                "designation": row["designation"],
                "company": row["company"],
                "sector": row["sector"],
                "accreditation_number": row["accreditation_number"],
                "valid_until": row["valid_until"],
                "qualifications": [],
            },
        )
        if row["qualification"] not in item["qualifications"]:
            item["qualifications"].append(row["qualification"])
        if not item["accreditation_number"] and row["accreditation_number"]:
            item["accreditation_number"] = row["accreditation_number"]
            item["valid_until"] = row["valid_until"]

    name_counts: dict[str, int] = {}
    for item in grouped.values():
        name_counts[item["name"].casefold()] = name_counts.get(item["name"].casefold(), 0) + 1
    for item in grouped.values():
        if name_counts[item["name"].casefold()] > 1:
            extra = item["accreditation_number"] or item["address"]
            if extra:
                item["display_name"] = f"{item['name']} ({extra})"
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
        "date_accredited": _stringify(row.get("DATE ACCREDITED")),
        "valid_until": _stringify(row.get("VALID UNTIL")),
    }


def _assessor_record(row: pd.Series, source: str) -> dict:
    name = normalize_text(row.get("NAME"))
    qualification = normalize_text(row.get("QUALIFICATION TITLE"))
    accreditation = _stringify(row.get("ACCREDITATION NUMBER"))
    birth = _stringify(row.get("DATE OF BIRTH"))
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
        "valid_until": _stringify(row.get("VALID UNTIL")),
    }
