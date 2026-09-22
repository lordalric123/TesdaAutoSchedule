"""TESDA Southern Leyte Competency Assessment Scheduler."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import uuid
import zipfile
from datetime import date, datetime
from io import BytesIO
from pathlib import Path

from flask import Flask, jsonify, request, send_file, send_from_directory
from werkzeug.utils import secure_filename

from date_rules import calculate_derived_dates, parse_iso_date
from excel_loader import ExcelRegistry
from monitoring_export import build_assessor_history_workbook, build_monitoring_workbook
from storage import JsonStore

ROOT = Path(__file__).resolve().parent
# The bundled/default Excel files shipped with the code — used only to seed a fresh
# persistent data directory the first time the app runs there. Never written to.
SEED_EXCEL_DIR = ROOT / "data" / "excel"

# All writable app state (assessments, settings, uploaded Excel files, task checkmarks)
# lives under DATA_DIR.
# Prefer an existing non-empty saved dataset so app restarts don't silently reset user
# records. If APP_DATA_DIR is explicitly set, it wins. Otherwise, we choose the
# project data folder if it already contains records; otherwise we fall back to a
# user-level persistent directory. This avoids wiping valid data when switching
# versions or moving the project.
PROJECT_DATA_DIR = ROOT / "data"
LEGACY_PERSISTENT_DIR = Path.home() / ".tesda_auto_schedule_data"

def resolve_data_dir() -> Path:
    env_path = os.environ.get("APP_DATA_DIR")
    if env_path:
        return Path(env_path).resolve()

    for candidate in (PROJECT_DATA_DIR, LEGACY_PERSISTENT_DIR):
        if candidate.exists():
            files = list(candidate.glob("*.json"))
            if files:
                # Prefer the dataset with actual saved records; if both contain data,
                # keep the project directory as the source of truth.
                return candidate.resolve()

    return PROJECT_DATA_DIR.resolve()


DATA_DIR = resolve_data_dir()
EXCEL_DIR = DATA_DIR / "excel"
STATIC_DIR = ROOT / "static"

DEFAULT_CENTERS = EXCEL_DIR / "assessment_centers.xlsx"
DEFAULT_PROVINCE_ASSESSORS = EXCEL_DIR / "competency_assessors.xlsx"
DEFAULT_REGION_ASSESSORS = EXCEL_DIR / "region_assessors.xlsx"
DEFAULT_ASSESSORS = DEFAULT_PROVINCE_ASSESSORS


def seed_excel_dir() -> None:
    """Copy the bundled default Excel files into EXCEL_DIR if it's empty.

    Only relevant the first time the app boots against a fresh, empty persistent
    volume (APP_DATA_DIR pointed somewhere new). Never overwrites files that are
    already there (e.g. ones a user has already uploaded).
    """
    if EXCEL_DIR.resolve() == SEED_EXCEL_DIR.resolve():
        return
    if not SEED_EXCEL_DIR.exists():
        return
    EXCEL_DIR.mkdir(parents=True, exist_ok=True)
    for seed_file in SEED_EXCEL_DIR.glob("*.xlsx"):
        dest = EXCEL_DIR / seed_file.name
        if not dest.exists():
            shutil.copy2(seed_file, dest)


seed_excel_dir()


DEFAULT_THEME = {
    "preset": "default",
    "primary": "#0f766e",
    "secondary": "#5eead4",
    "background": "#071018",
    "text": "#e8f4f2",
    "highlight": "#e8c36a",
}

THEME_PRESETS = {
    "default": dict(DEFAULT_THEME),
    "dark": {
        "preset": "dark",
        "primary": "#22d3ee",
        "secondary": "#67e8f9",
        "background": "#020617",
        "text": "#f8fafc",
        "highlight": "#fbbf24",
    },
    "light": {
        "preset": "light",
        "primary": "#0f766e",
        "secondary": "#0d9488",
        "background": "#f4f7f8",
        "text": "#12303a",
        "highlight": "#b45309",
    },
}

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")
registry = ExcelRegistry()
settings_store = JsonStore(
    DATA_DIR / "settings.json",
    {
        "centers_path": str(DEFAULT_CENTERS),
        "province_assessors_path": str(DEFAULT_PROVINCE_ASSESSORS),
        "region_assessors_path": str(DEFAULT_REGION_ASSESSORS),
        "assessors_path": str(DEFAULT_PROVINCE_ASSESSORS),
        "theme": dict(DEFAULT_THEME),
    },
)
assessments_store = JsonStore(DATA_DIR / "assessments.json", [])
representatives_store = JsonStore(DATA_DIR / "representatives.json", [])
task_status_store = JsonStore(DATA_DIR / "task_status.json", {})


def task_id(assessment_id: str, kind: str, event_date: str) -> str:
    return f"{assessment_id}::{kind}::{event_date}"


def today() -> date:
    return date.today()


def normalize_settings(raw: dict | None = None) -> dict:
    settings = dict(raw or settings_store.read())
    if not settings.get("province_assessors_path"):
        settings["province_assessors_path"] = settings.get("assessors_path") or str(DEFAULT_PROVINCE_ASSESSORS)
    settings["assessors_path"] = settings["province_assessors_path"]
    settings.setdefault("region_assessors_path", str(DEFAULT_REGION_ASSESSORS))
    theme = dict(DEFAULT_THEME)
    theme.update(settings.get("theme") or {})
    settings["theme"] = theme
    return settings


def load_registry() -> None:
    settings = normalize_settings()
    settings_store.write(settings)
    registry.load(
        settings["centers_path"],
        settings["province_assessors_path"],
        settings.get("region_assessors_path"),
    )


def unique_dates(pairs: list[dict], key: str = "date") -> list[str]:
    seen: list[str] = []
    for pair in pairs:
        value = pair[key]
        if value not in seen:
            seen.append(value)
    return seen


def format_range(start: str, end: str) -> str:
    start_d = parse_iso_date(start)
    end_d = parse_iso_date(end)
    if start == end:
        return start_d.strftime("%B %d, %Y")
    if start_d.year == end_d.year and start_d.month == end_d.month:
        return f"{start_d.strftime('%B')} {start_d.day}–{end_d.day}, {start_d.year}"
    if start_d.year == end_d.year:
        return f"{start_d.strftime('%B %d')}–{end_d.strftime('%B %d, %Y')}"
    return f"{start_d.strftime('%B %d, %Y')}–{end_d.strftime('%B %d, %Y')}"


def normalize_assessors(payload: dict, existing: dict | None = None) -> list[dict]:
    """Build the assessors list from a payload, tolerating the old single-assessor shape."""
    raw = payload.get("assessors")
    if not isinstance(raw, list) or not raw:
        legacy_name = (payload.get("assessor") or "").strip()
        if legacy_name:
            raw = [{"name": legacy_name, "assessor_type": payload.get("assessor_type") or "province"}]
        elif existing and existing.get("assessors"):
            raw = existing["assessors"]
        elif existing and existing.get("assessor"):
            raw = [{"name": existing["assessor"], "assessor_type": existing.get("assessor_type") or "province"}]
        else:
            raw = []

    assessors: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        name = (entry.get("name") or "").strip()
        assessor_type = entry.get("assessor_type") or "province"
        if assessor_type not in {"province", "region"}:
            raise ValueError("Assessor type must be province or region.")
        if not name:
            continue
        key = (name.casefold(), assessor_type)
        if key in seen:
            continue
        seen.add(key)
        assessors.append({"name": name, "assessor_type": assessor_type})
    return assessors


def decorate(assessment: dict) -> dict:
    item = dict(assessment)
    if not item.get("assessors"):
        item["assessors"] = [
            {
                "name": item.get("assessor", ""),
                "assessor_type": _assessor_type_value(item),
            }
        ]
    item.setdefault("assessor", item["assessors"][0]["name"])
    item.setdefault("assessor_type", item["assessors"][0]["assessor_type"])
    item["assessor_type_label"] = "Region-Based" if item["assessor_type"] == "region" else "Province-Based"
    item["assessors_label"] = "; ".join(
        f"{a['name']} ({'Region-Based' if a['assessor_type'] == 'region' else 'Province-Based'})"
        for a in item["assessors"]
    )
    item["date_label"] = format_range(item["start_date"], item["end_date"])
    item["approved_date_list"] = unique_dates(item["approved_dates"])
    item["schedule_reminder_list"] = unique_dates(item["schedule_reminder_dates"])
    item["results_reminder_list"] = unique_dates(item["results_reminder_dates"])
    return item


def build_assessment(payload: dict, existing: dict | None = None) -> dict:
    center = (payload.get("assessment_center") or "").strip()
    qualification = (payload.get("qualification") or "").strip()
    duration_type = payload.get("duration_type") or "single"
    if duration_type not in {"single", "continuous"}:
        raise ValueError("Assessment duration must be single or continuous.")
    start = parse_iso_date(payload["start_date"])
    end = parse_iso_date(payload.get("end_date") or payload["start_date"])
    if duration_type == "single":
        end = start
    pax = int(payload.get("pax") or 0)
    if pax < 1:
        raise ValueError("Number of pax must be at least 1.")
    assessors = normalize_assessors(payload, existing)
    representative = (payload.get("tesda_representative") or "").strip()
    if not center or not qualification:
        raise ValueError("Assessment center and qualification are required.")
    if not assessors:
        raise ValueError("At least one assessor is required.")

    derived = calculate_derived_dates(start, end, duration_type)
    now = datetime.now().isoformat(timespec="seconds")
    return {
        "id": existing["id"] if existing else str(uuid.uuid4()),
        "assessment_center": center,
        "qualification": qualification,
        "duration_type": duration_type,
        "start_date": derived["start_date"],
        "end_date": derived["end_date"],
        "pax": pax,
        "assessors": assessors,
        # legacy single-assessor fields kept in sync for any old code/exports that read them
        "assessor": assessors[0]["name"],
        "assessor_type": assessors[0]["assessor_type"],
        "tesda_representative": representative,
        "assessment_dates": derived["assessment_dates"],
        "approved_dates": derived["approved_dates"],
        "schedule_reminder_dates": derived["schedule_reminder_dates"],
        "results_reminder_dates": derived["results_reminder_dates"],
        "created_at": existing["created_at"] if existing else now,
        "updated_at": now,
    }


def get_assessment(assessment_id: str) -> dict | None:
    for item in assessments_store.read():
        if item["id"] == assessment_id:
            return item
    return None


def overlaps_year(assessment: dict, year: int) -> bool:
    start = parse_iso_date(assessment["start_date"])
    end = parse_iso_date(assessment["end_date"])
    return start.year <= year <= end.year


def overlaps_month(assessment: dict, year: int, month: int) -> bool:
    start = parse_iso_date(assessment["start_date"])
    end = parse_iso_date(assessment["end_date"])
    month_start = date(year, month, 1)
    if month == 12:
        month_end = date(year + 1, 1, 1)
    else:
        month_end = date(year, month + 1, 1)
    return start < month_end and end >= month_start


def _assessor_type_value(item: dict) -> str:
    value = item.get("assessor_type") or "province"
    return value if value in {"province", "region"} else "province"


def build_assessor_rotation(
    assessments: list[dict],
    registry: "ExcelRegistry",
    qualification: str = "",
    assessor_type: str = "",
) -> dict:
    """For a qualification, show every eligible assessor with their assessment history,
    ordered so the assessor who has gone longest without an assignment (or has never
    been assigned) appears first — i.e. who's next in the rotation.
    """
    qualification = (qualification or "").strip()
    assessor_type = (assessor_type or "").strip()
    if assessor_type not in {"", "province", "region"}:
        raise ValueError("Assessor type must be province or region.")

    decorated_all = [decorate(item) for item in assessments]
    all_qualifications = sorted(
        set(registry.all_qualifications()) | {item["qualification"] for item in decorated_all},
        key=str.casefold,
    )
    decorated = (
        [item for item in decorated_all if item["qualification"] == qualification]
        if qualification
        else []
    )

    entries: dict[tuple[str, str], dict] = {}

    def ensure(key: tuple[str, str], name: str, source: str) -> dict:
        row = entries.get(key)
        if not row:
            row = {
                "assessor": name,
                "assessor_type": source,
                "assessor_type_label": "Region-Based" if source == "region" else "Province-Based",
                "address": "",
                "designation": "",
                "history": [],
            }
            entries[key] = row
        return row

    if qualification:
        for person in registry.assessors(qualification):
            source = person.get("assessor_type") or "province"
            if assessor_type and source != assessor_type:
                continue
            key = (person["name"].casefold(), source)
            row = ensure(key, person.get("display_name") or person["name"], source)
            row["address"] = person.get("address", "")
            row["designation"] = person.get("designation") or person.get("company") or ""

        for item in decorated:
            for entry in item["assessors"]:
                source = entry["assessor_type"]
                if assessor_type and source != assessor_type:
                    continue
                key = (entry["name"].casefold(), source)
                row = ensure(key, entry["name"], source)
                row["history"].append(
                    {
                        "date": item["start_date"],
                        "end_date": item["end_date"],
                        "assessment_center": item["assessment_center"],
                        "pax": item["pax"],
                    }
                )

    assessment_log = []
    log_source = decorated if qualification else decorated_all
    for item in log_source:
        entry_assessors = item["assessors"]
        if assessor_type:
            entry_assessors = [a for a in entry_assessors if a["assessor_type"] == assessor_type]
            if not entry_assessors:
                continue
        assessment_log.append(
            {
                "id": item["id"],
                "start_date": item["start_date"],
                "end_date": item["end_date"],
                "date_label": item["date_label"],
                "assessment_center": item["assessment_center"],
                "qualification": item["qualification"],
                "pax": item["pax"],
                "assessors": entry_assessors,
                "tesda_representative": item.get("tesda_representative", ""),
            }
        )
    assessment_log.sort(key=lambda x: x["start_date"], reverse=True)

    today_iso = date.today().isoformat()
    rotation = []
    for row in entries.values():
        history_sorted = sorted(row["history"], key=lambda h: h["date"], reverse=True)
        row["history"] = history_sorted
        row["assessments_conducted"] = len(history_sorted)
        last_date = history_sorted[0]["date"] if history_sorted else None
        row["last_assessment_date"] = last_date
        row["days_since_last"] = (
            (parse_iso_date(today_iso) - parse_iso_date(last_date)).days if last_date else None
        )
        rotation.append(row)

    rotation.sort(
        key=lambda r: (
            r["last_assessment_date"] is not None,
            r["last_assessment_date"] or "",
            r["assessor"].casefold(),
        )
    )

    return {
        "qualification": qualification,
        "assessor_type": assessor_type,
        "today": today_iso,
        "qualifications": all_qualifications,
        "rotation": rotation,
        "assessment_log": assessment_log,
    }


def calendar_events(calendar_type: str, year: int, month: int) -> dict[str, list[dict]]:
    statuses = task_status_store.read()
    events: dict[str, list[dict]] = {}
    for assessment in assessments_store.read():
        item = decorate(assessment)
        if calendar_type == "approved":
            for pair in item["approved_dates"]:
                event_date = pair["date"]
                if _in_month(event_date, year, month):
                    tid = task_id(item["id"], "schedule", pair["assessment_date"])
                    events.setdefault(event_date, []).append(
                        {
                            "kind": "approved",
                            "title": "Create portal schedule",
                            "detail": f"Create portal schedule for {format_range(pair['assessment_date'], pair['assessment_date'])}.",
                            "assessment": item,
                            "task_id": tid,
                            "done": bool(statuses.get(tid, {}).get("done")),
                        }
                    )
        elif calendar_type == "results":
            for pair in item["results_reminder_dates"]:
                event_date = pair["date"]
                if _in_month(event_date, year, month):
                    tid = task_id(item["id"], "results", pair["assessment_date"])
                    events.setdefault(event_date, []).append(
                        {
                            "kind": "results",
                            "title": "Results reminder",
                            "detail": f"Show/submit results for the assessment conducted on {format_range(pair['assessment_date'], pair['assessment_date'])}.",
                            "assessment": item,
                            "task_id": tid,
                            "done": bool(statuses.get(tid, {}).get("done")),
                        }
                    )
        else:
            if overlaps_month(item, year, month):
                # Place the range on every assessment date so the month grid can show it,
                # but the UI treats it as one continuous record, and one checklist task.
                tid = task_id(item["id"], "assessment", item["start_date"])
                done = bool(statuses.get(tid, {}).get("done"))
                for day in item["assessment_dates"]:
                    if _in_month(day, year, month):
                        events.setdefault(day, []).append(
                            {
                                "kind": "assessment",
                                "title": item["qualification"],
                                "detail": item["date_label"],
                                "assessment": item,
                                "range_id": item["id"],
                                "task_id": tid,
                                "done": done,
                            }
                        )
    return events


def _in_month(iso_value: str, year: int, month: int) -> bool:
    value = parse_iso_date(iso_value)
    return value.year == year and value.month == month


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "today": today().isoformat()})


@app.get("/api/settings")
def get_settings():
    settings = normalize_settings()
    return jsonify({**settings, **registry.summary(), "theme_presets": THEME_PRESETS})


@app.post("/api/settings/theme")
def save_theme():
    payload = request.get_json(force=True) or {}
    preset = payload.get("preset") or "custom"
    if preset in THEME_PRESETS and preset != "custom":
        theme = dict(THEME_PRESETS[preset])
    else:
        theme = dict(DEFAULT_THEME)
        theme.update(payload)
        theme["preset"] = "custom"
    settings = normalize_settings()
    settings["theme"] = {
        "preset": theme.get("preset", "custom"),
        "primary": theme.get("primary") or DEFAULT_THEME["primary"],
        "secondary": theme.get("secondary") or DEFAULT_THEME["secondary"],
        "background": theme.get("background") or DEFAULT_THEME["background"],
        "text": theme.get("text") or DEFAULT_THEME["text"],
        "highlight": theme.get("highlight") or DEFAULT_THEME["highlight"],
    }
    settings_store.write(settings)
    return jsonify({"ok": True, "theme": settings["theme"]})


@app.post("/api/settings/theme/reset")
def reset_theme():
    settings = normalize_settings()
    settings["theme"] = dict(DEFAULT_THEME)
    settings_store.write(settings)
    return jsonify({"ok": True, "theme": settings["theme"]})


@app.post("/api/settings/reload")
def reload_data():
    try:
        load_registry()
        return jsonify({"ok": True, **registry.summary()})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.post("/api/settings/upload")
def upload_excel():
    kind = request.form.get("kind")
    uploaded = request.files.get("file")
    if kind not in {"centers", "province", "region", "assessors"} or not uploaded or not uploaded.filename:
        return jsonify({"ok": False, "error": "Upload an Excel file for centers or assessors."}), 400
    if kind == "assessors":
        kind = "province"
    filename = secure_filename(uploaded.filename)
    suffix = Path(filename).suffix.lower()
    if suffix not in {".xlsx", ".xls"}:
        return jsonify({"ok": False, "error": "Please upload an .xlsx Excel file."}), 400
    dest_name = {
        "centers": "assessment_centers.xlsx",
        "province": "competency_assessors.xlsx",
        "region": "region_assessors.xlsx",
    }[kind]
    dest = EXCEL_DIR / dest_name
    EXCEL_DIR.mkdir(parents=True, exist_ok=True)
    uploaded.save(dest)
    settings = normalize_settings()
    if kind == "centers":
        settings["centers_path"] = str(dest)
    elif kind == "region":
        settings["region_assessors_path"] = str(dest)
    else:
        settings["province_assessors_path"] = str(dest)
        settings["assessors_path"] = str(dest)
    settings_store.write(settings)
    try:
        load_registry()
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc), **registry.summary()}), 400
    return jsonify({"ok": True, **registry.summary()})


@app.get("/api/centers")
def centers():
    return jsonify(registry.assessment_centers())


@app.get("/api/qualifications")
def qualifications():
    center = request.args.get("center", "")
    if center:
        return jsonify(registry.qualifications_for_center(center))
    return jsonify(registry.all_qualifications())


@app.get("/api/assessors")
def assessors():
    qualification = request.args.get("qualification") or None
    source = request.args.get("source") or request.args.get("assessor_type") or None
    if source not in {None, "", "province", "region"}:
        return jsonify({"error": "Assessor source must be province or region."}), 400
    people = registry.assessors(qualification, source or None)
    if qualification and not people:
        people = registry.assessors(source=source or None)
        return jsonify({"filtered": False, "assessors": people, "source": source or "all"})
    return jsonify({"filtered": bool(qualification), "assessors": people, "source": source or "all"})


@app.get("/api/finder")
def finder():
    query = request.args.get("q", "").strip()
    suggestions = registry.find_qualification(query)
    selected = request.args.get("qualification", "").strip()
    source = request.args.get("source") or None
    if source not in {None, "", "province", "region"}:
        return jsonify({"error": "Assessor source must be province or region."}), 400
    if not selected and len(suggestions) == 1:
        selected = suggestions[0]
    result = registry.finder(selected, source) if selected else {"qualification": "", "assessors": [], "centers": []}
    return jsonify(
        {
            "query": query,
            "suggestions": suggestions,
            "source": source or "",
            **result,
            "assessor_count": len(result["assessors"]),
            "center_count": len(result["centers"]),
        }
    )


@app.get("/api/representatives")
def list_representatives():
    people = sorted(representatives_store.read(), key=lambda x: x["name"].casefold())
    return jsonify(people)


@app.post("/api/representatives")
def create_representative():
    payload = request.get_json(force=True)
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Representative name is required."}), 400
    people = representatives_store.read()
    person = {
        "id": str(uuid.uuid4()),
        "name": name,
        "position": (payload.get("position") or "").strip(),
        "contact": (payload.get("contact") or "").strip(),
        "notes": (payload.get("notes") or "").strip(),
    }
    people.append(person)
    representatives_store.write(people)
    return jsonify(person), 201


@app.put("/api/representatives/<rep_id>")
def update_representative(rep_id: str):
    payload = request.get_json(force=True)
    people = representatives_store.read()
    for index, person in enumerate(people):
        if person["id"] == rep_id:
            person = {
                **person,
                "name": (payload.get("name") or person["name"]).strip(),
                "position": (payload.get("position") or "").strip(),
                "contact": (payload.get("contact") or "").strip(),
                "notes": (payload.get("notes") or "").strip(),
            }
            if not person["name"]:
                return jsonify({"error": "Representative name is required."}), 400
            people[index] = person
            representatives_store.write(people)
            return jsonify(person)
    return jsonify({"error": "Representative not found."}), 404


@app.delete("/api/representatives/<rep_id>")
def delete_representative(rep_id: str):
    people = [person for person in representatives_store.read() if person["id"] != rep_id]
    representatives_store.write(people)
    return jsonify({"ok": True})


@app.get("/api/assessments")
def list_assessments():
    items = [decorate(item) for item in assessments_store.read()]
    items.sort(key=lambda x: x["start_date"], reverse=True)
    return jsonify(items)


@app.post("/api/assessments")
def create_assessment():
    try:
        item = build_assessment(request.get_json(force=True))
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400
    items = assessments_store.read()
    items.append(item)
    assessments_store.write(items)
    return jsonify(decorate(item)), 201


@app.put("/api/assessments/<assessment_id>")
def update_assessment(assessment_id: str):
    existing = get_assessment(assessment_id)
    if not existing:
        return jsonify({"error": "Assessment not found."}), 404
    try:
        item = build_assessment(request.get_json(force=True), existing)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400
    items = [item if row["id"] == assessment_id else row for row in assessments_store.read()]
    assessments_store.write(items)
    return jsonify(decorate(item))


@app.delete("/api/assessments/<assessment_id>")
def delete_assessment(assessment_id: str):
    items = [row for row in assessments_store.read() if row["id"] != assessment_id]
    assessments_store.write(items)
    statuses = task_status_store.read()
    remaining = {tid: v for tid, v in statuses.items() if not tid.startswith(f"{assessment_id}::")}
    if len(remaining) != len(statuses):
        task_status_store.write(remaining)
    return jsonify({"ok": True})


@app.get("/api/dashboard")
def dashboard():
    current = today().isoformat()
    statuses = task_status_store.read()
    assessments = [decorate(item) for item in assessments_store.read()]
    schedule_today = []
    results_today = []
    assessments_today = []
    upcoming = []
    needing_schedule = []
    results_due_count = 0
    this_month = 0

    seen_schedule = set()
    seen_results = set()

    def with_task(item: dict, kind: str, event_date: str) -> dict:
        tid = task_id(item["id"], kind, event_date)
        return {**item, "task_id": tid, "done": bool(statuses.get(tid, {}).get("done"))}

    for item in assessments:
        start = parse_iso_date(item["start_date"])
        end = parse_iso_date(item["end_date"])
        if start.year == today().year and start.month == today().month:
            this_month += 1
        if start <= today() <= end:
            assessments_today.append(with_task(item, "assessment", item["start_date"]))
        if start > today():
            upcoming.append(with_task(item, "assessment", item["start_date"]))
        for pair in item["schedule_reminder_dates"]:
            key = (item["id"], pair["assessment_date"], "schedule")
            if pair["date"] == current and key not in seen_schedule:
                seen_schedule.add(key)
                tid = task_id(item["id"], "schedule", pair["assessment_date"])
                schedule_today.append({**pair, "assessment": item, "task_id": tid, "done": bool(statuses.get(tid, {}).get("done"))})
            if pair["date"] >= current:
                needing_schedule.append(key)
        for pair in item["results_reminder_dates"]:
            key = (item["id"], pair["assessment_date"], "results")
            if pair["date"] == current and key not in seen_results:
                seen_results.add(key)
                tid = task_id(item["id"], "results", pair["assessment_date"])
                results_today.append({**pair, "assessment": item, "task_id": tid, "done": bool(statuses.get(tid, {}).get("done"))})
            if pair["date"] == current:
                results_due_count += 1

    upcoming.sort(key=lambda x: x["start_date"])
    tasks_today_all = schedule_today + results_today + assessments_today
    return jsonify(
        {
            "today": current,
            "schedule_today": schedule_today,
            "results_today": results_today,
            "assessments_today": assessments_today,
            "upcoming": upcoming[:8],
            "summary": {
                "assessments_this_month": this_month,
                "upcoming_assessments": len(upcoming),
                "requiring_scheduling": len(set(needing_schedule)),
                "results_due_today": results_due_count,
                "tasks_today": len(tasks_today_all),
                "tasks_pending_today": sum(1 for t in tasks_today_all if not t.get("done")),
            },
        }
    )


@app.get("/api/calendar")
def calendar():
    calendar_type = request.args.get("type", "assessment")
    if calendar_type not in {"approved", "assessment", "results"}:
        return jsonify({"error": "Unknown calendar type."}), 400
    year = int(request.args.get("year", today().year))
    month = int(request.args.get("month", today().month))
    events = calendar_events(calendar_type, year, month)
    compact = {
        day: {
            "count": len(items),
            "pending": sum(1 for item in items if not item.get("done")),
            "kinds": sorted({item["kind"] for item in items}),
        }
        for day, items in events.items()
    }
    return jsonify(
        {
            "type": calendar_type,
            "year": year,
            "month": month,
            "today": today().isoformat(),
            "compact": compact,
            "events": events,
        }
    )


@app.post("/api/tasks/toggle")
def toggle_task():
    payload = request.get_json(force=True) or {}
    tid = (payload.get("task_id") or "").strip()
    if not tid:
        return jsonify({"error": "task_id is required."}), 400
    done = bool(payload.get("done", True))
    statuses = task_status_store.read()
    if done:
        statuses[tid] = {"done": True, "done_at": datetime.now().isoformat(timespec="seconds")}
    else:
        statuses.pop(tid, None)
    task_status_store.write(statuses)
    return jsonify({"task_id": tid, "done": done})


@app.get("/api/assessor-rotation/export")
def export_assessor_history():
    qualification = (request.args.get("qualification") or "").strip()
    assessor_type = request.args.get("assessor_type") or ""
    try:
        data = build_assessor_rotation(assessments_store.read(), registry, qualification, assessor_type)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    title = f"Assessor History — {qualification}" if qualification else "Assessor History — All Qualifications"
    buffer = build_assessor_history_workbook(data["assessment_log"], title=title)
    stamp = datetime.now().strftime("%Y%m%d")
    name_bits = ["Assessor_History"]
    if qualification:
        name_bits.append(qualification)
    if assessor_type:
        name_bits.append(assessor_type)
    name_bits.append(stamp)
    filename = secure_filename("_".join(name_bits) + ".xlsx")
    return send_file(
        buffer,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.get("/api/reports")
def reports():
    year = int(request.args.get("year", today().year))
    month = int(request.args.get("month", today().month))
    query = (request.args.get("q") or "").strip().casefold()
    items = [decorate(item) for item in assessments_store.read() if overlaps_month(item, year, month)]
    if query:
        items = [
            item
            for item in items
            if query in item["assessment_center"].casefold()
            or query in item["qualification"].casefold()
            or any(query in a["name"].casefold() for a in item["assessors"])
            or query in item["tesda_representative"].casefold()
        ]
    items.sort(key=lambda x: x["start_date"])
    return jsonify({"year": year, "month": month, "items": items})


@app.get("/api/assessor-rotation")
def assessor_rotation():
    qualification = (request.args.get("qualification") or "").strip()
    assessor_type = request.args.get("assessor_type") or ""
    try:
        data = build_assessor_rotation(assessments_store.read(), registry, qualification, assessor_type)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(data)


@app.get("/api/reports/export")
def export_reports():
    year = int(request.args.get("year", today().year))
    month = int(request.args.get("month", today().month))
    items = [decorate(item) for item in assessments_store.read() if overlaps_month(item, year, month)]
    items.sort(key=lambda x: x["start_date"])
    buffer = build_monitoring_workbook(year, month, items)
    filename = f"Assessment_Schedule_{date(year, month, 1).strftime('%B_%Y')}.xlsx"
    return send_file(
        buffer,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.get("/api/backup/export")
def export_backup():
    import io

    buffer = io.BytesIO()
    settings = settings_store.read()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "manifest.json",
            json.dumps(
                {
                    "app": "TESDA Competency Assessment Scheduler",
                    "exported_at": datetime.now().isoformat(timespec="seconds"),
                    "version": 1,
                },
                indent=2,
            ),
        )
        archive.writestr("assessments.json", json.dumps(assessments_store.read(), indent=2, ensure_ascii=False))
        archive.writestr("representatives.json", json.dumps(representatives_store.read(), indent=2, ensure_ascii=False))
        archive.writestr("task_status.json", json.dumps(task_status_store.read(), indent=2, ensure_ascii=False))
        archive.writestr("settings.json", json.dumps(normalize_settings(settings), indent=2, ensure_ascii=False))
        for label, path_value in {
            "excel/assessment_centers.xlsx": settings.get("centers_path"),
            "excel/competency_assessors.xlsx": settings.get("province_assessors_path") or settings.get("assessors_path"),
            "excel/region_assessors.xlsx": settings.get("region_assessors_path"),
        }.items():
            path = Path(path_value) if path_value else None
            if path and path.exists():
                archive.write(path, label)
    buffer.seek(0)
    stamp = datetime.now().strftime("%Y%m%d")
    return send_file(
        buffer,
        as_attachment=True,
        download_name=f"TESDA_Scheduler_Backup_{stamp}.zip",
        mimetype="application/zip",
    )


@app.post("/api/backup/import")
def import_backup():
    uploaded = request.files.get("file")
    if not uploaded or not uploaded.filename:
        return jsonify({"ok": False, "error": "Choose a TESDA scheduler backup .zip file."}), 400
    if not uploaded.filename.lower().endswith(".zip"):
        return jsonify({"ok": False, "error": "Backup files must be a .zip export from this program."}), 400
    with tempfile.TemporaryDirectory() as raw_tmp:
        tmp = Path(raw_tmp)
        zip_path = tmp / "backup.zip"
        uploaded.save(zip_path)
        extract_dir = tmp / "extracted"
        extract_dir.mkdir()
        try:
            with zipfile.ZipFile(zip_path) as archive:
                archive.extractall(extract_dir)
        except zipfile.BadZipFile:
            return jsonify({"ok": False, "error": "That file is not a valid zip backup."}), 400

        assessments_file = _find_backup_file(extract_dir, "assessments.json")
        representatives_file = _find_backup_file(extract_dir, "representatives.json")
        if not assessments_file:
            return jsonify({"ok": False, "error": "Backup is missing assessments.json."}), 400
        try:
            assessments = json.loads(assessments_file.read_text(encoding="utf-8"))
            representatives = json.loads(representatives_file.read_text(encoding="utf-8")) if representatives_file else []
        except json.JSONDecodeError:
            return jsonify({"ok": False, "error": "Backup JSON could not be read."}), 400
        if not isinstance(assessments, list) or not isinstance(representatives, list):
            return jsonify({"ok": False, "error": "Backup data is not in the expected list format."}), 400

        assessments_store.write(assessments)
        representatives_store.write(representatives)

        task_status_file = _find_backup_file(extract_dir, "task_status.json")
        if task_status_file:
            try:
                task_statuses = json.loads(task_status_file.read_text(encoding="utf-8"))
                if isinstance(task_statuses, dict):
                    task_status_store.write(task_statuses)
            except json.JSONDecodeError:
                pass

        centers_src = _find_backup_file(extract_dir, "assessment_centers.xlsx")
        assessors_src = _find_backup_file(extract_dir, "competency_assessors.xlsx")
        region_src = _find_backup_file(extract_dir, "region_assessors.xlsx")
        EXCEL_DIR.mkdir(parents=True, exist_ok=True)
        if centers_src:
            shutil.copyfile(centers_src, DEFAULT_CENTERS)
        if assessors_src:
            shutil.copyfile(assessors_src, DEFAULT_PROVINCE_ASSESSORS)
        if region_src:
            shutil.copyfile(region_src, DEFAULT_REGION_ASSESSORS)
        imported_settings = {}
        settings_file = _find_backup_file(extract_dir, "settings.json")
        if settings_file:
            try:
                imported_settings = json.loads(settings_file.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                imported_settings = {}
        merged = normalize_settings(
            {
                "centers_path": str(DEFAULT_CENTERS),
                "province_assessors_path": str(DEFAULT_PROVINCE_ASSESSORS),
                "assessors_path": str(DEFAULT_PROVINCE_ASSESSORS),
                "region_assessors_path": str(DEFAULT_REGION_ASSESSORS),
                "theme": (imported_settings or {}).get("theme") or dict(DEFAULT_THEME),
            }
        )
        settings_store.write(merged)
        try:
            load_registry()
        except Exception as exc:
            return jsonify({"ok": False, "error": f"Data imported, but Excel reload failed: {exc}"}), 400
    return jsonify(
        {
            "ok": True,
            "assessments": len(assessments_store.read()),
            "representatives": len(representatives_store.read()),
            **registry.summary(),
        }
    )


def _find_backup_file(root: Path, name: str) -> Path | None:
    matches = [path for path in root.rglob(name) if path.is_file()]
    return matches[0] if matches else None


try:
    load_registry()
except Exception as exc:
    registry.error = str(exc)


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5050"))
    debug = os.environ.get("DEBUG", "false").lower() in {"1", "true", "yes"}
    app.run(host=host, port=port, debug=debug, use_reloader=debug)
