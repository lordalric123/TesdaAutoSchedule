from date_rules import calculate_derived_dates, schedule_reminder_for_assessment_date
from datetime import date


def test_single_day_monday_moves_to_thursday():
    derived = calculate_derived_dates(date(2026, 9, 14), date(2026, 9, 14), "single")
    assert derived["approved_dates"][0]["date"] == "2026-09-10"
    assert derived["results_reminder_dates"][0]["date"] == "2026-09-15"


def test_single_day_tuesday_moves_to_friday():
    assert schedule_reminder_for_assessment_date(date(2026, 9, 15), "single").isoformat() == "2026-09-11"


def test_single_day_weekday_unchanged():
    assert schedule_reminder_for_assessment_date(date(2026, 9, 16), "single").isoformat() == "2026-09-14"


def test_continuous_keeps_weekend_reminder():
    derived = calculate_derived_dates(date(2026, 9, 11), date(2026, 9, 14), "continuous")
    by_assessment = {row["assessment_date"]: row["date"] for row in derived["approved_dates"]}
    assert by_assessment["2026-09-11"] == "2026-09-09"
    assert by_assessment["2026-09-12"] == "2026-09-10"
    assert by_assessment["2026-09-13"] == "2026-09-11"
    assert by_assessment["2026-09-14"] == "2026-09-12"
    results = {row["assessment_date"]: row["date"] for row in derived["results_reminder_dates"]}
    assert results["2026-09-11"] == "2026-09-12"
    assert results["2026-09-14"] == "2026-09-15"
    assert derived["start_date"] == "2026-09-11"
    assert derived["end_date"] == "2026-09-14"


def test_old_single_day_schedule_dates_are_recomputed_to_business_days():
    from app import decorate

    stale = {
        "id": "old-1",
        "assessment_center": "Center",
        "qualification": "Qualification",
        "duration_type": "single",
        "start_date": "2026-09-28",
        "end_date": "2026-09-28",
        "pax": 10,
        "assessors": [],
        "tesda_representative": "Jane",
        "approved_dates": [{"assessment_date": "2026-09-28", "date": "2026-09-26"}],
        "schedule_reminder_dates": [{"assessment_date": "2026-09-28", "date": "2026-09-26"}],
        "results_reminder_dates": [{"assessment_date": "2026-09-28", "date": "2026-09-29"}],
        "assessment_dates": ["2026-09-28"],
    }

    item = decorate(stale)
    assert item["approved_dates"][0]["date"] == "2026-09-24"
    assert item["schedule_reminder_dates"][0]["date"] == "2026-09-24"
    assert item["assessor_warning"] == "Warning: no assessor assigned yet."


def test_single_day_monday_uses_previous_thursday():
    assert schedule_reminder_for_assessment_date(date(2026, 9, 28), "single").isoformat() == "2026-09-24"


def test_monitoring_date_labels():
    from monitoring_export import compact_approved_dates, compact_day_span

    assert compact_day_span(date(2026, 9, 14), date(2026, 9, 14)) == "14"
    assert compact_day_span(date(2026, 9, 11), date(2026, 9, 14)) == "11-14"
    assert compact_approved_dates(["2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12"]) == "9/9-12/2026"
