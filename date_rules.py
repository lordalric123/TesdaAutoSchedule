"""TESDA competency assessment date calculation rules."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Literal


DurationType = Literal["single", "multiple", "continuous"]


def parse_iso_date(value: str) -> date:
    return date.fromisoformat(value)


def daterange(start: date, end: date) -> list[date]:
    if end < start:
        raise ValueError("End date cannot be earlier than start date.")
    days = (end - start).days
    return [start + timedelta(days=i) for i in range(days + 1)]


def previous_business_day(value: date) -> date:
    candidate = value - timedelta(days=1)
    while candidate.weekday() >= 5:  # Saturday or Sunday
        candidate -= timedelta(days=1)
    return candidate


def adjust_weekend_for_single_day(reminder: date) -> date:
    """Move Saturday/Sunday reminders to the preceding weekday."""
    weekday = reminder.weekday()  # Mon=0 ... Sat=5 Sun=6
    if weekday >= 5:
        return previous_business_day(reminder)
    return reminder


def schedule_reminder_for_assessment_date(assessment_date: date, duration_type: DurationType) -> date:
    # The portal-schedule ("approved") date is always 2 business days before its own
    # assessment date, with weekends skipped — applied per assessment date, whether the
    # assessment is a single day or part of a continuous/multi-day run. (e.g. for a run of
    # Mon-Thu, each day gets its own minus-2-business-days date, not a flat minus-2-calendar-days
    # applied uniformly across the whole span.)
    reminder = assessment_date
    for _ in range(2):
        reminder = previous_business_day(reminder)
    return reminder


def results_reminder_for_assessment_date(assessment_date: date) -> date:
    return assessment_date + timedelta(days=1)


def calculate_derived_dates(
    start: date,
    end: date,
    duration_type: DurationType,
    explicit_dates: list[date] | None = None,
) -> dict:
    if duration_type == "single":
        end = start
        assessment_dates = [start]
    elif duration_type == "multiple":
        # Non-continuous schedule: the caller supplies the exact assessment dates
        # (e.g. 28, 30, 31 — skipping 29), rather than a filled start..end range.
        if not explicit_dates:
            raise ValueError("Select at least one assessment date for a multiple-day assessment.")
        assessment_dates = sorted(set(explicit_dates))
        start = assessment_dates[0]
        end = assessment_dates[-1]
    else:  # continuous
        assessment_dates = daterange(start, end)
    schedule_pairs = [
        {
            "assessment_date": d.isoformat(),
            "date": schedule_reminder_for_assessment_date(d, duration_type).isoformat(),
        }
        for d in assessment_dates
    ]
    results_pairs = [
        {
            "assessment_date": d.isoformat(),
            "date": results_reminder_for_assessment_date(d).isoformat(),
        }
        for d in assessment_dates
    ]
    return {
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "assessment_dates": [d.isoformat() for d in assessment_dates],
        "approved_dates": schedule_pairs,
        "schedule_reminder_dates": schedule_pairs,
        "results_reminder_dates": results_pairs,
    }
