"""TESDA competency assessment date calculation rules."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Literal


DurationType = Literal["single", "continuous"]


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


def schedule_reminder_for_assessment_date(
    assessment_date: date,
    duration_type: DurationType,
    starts_on_weekend: bool = False,
) -> date:
    if duration_type == "continuous" and starts_on_weekend:
        # Exception: a continuous assessment that itself BEGINS on a Saturday
        # or Sunday counts Sat/Sun normally — flat 2 calendar days before,
        # no skipping.
        return assessment_date - timedelta(days=2)
    # Default (single-day assessments; continuous assessments that begin on
    # a weekday, even if the range later runs through a weekend): the
    # reminder always lands on a business day — 2 business days before,
    # skipping Sat/Sun entirely.
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
) -> dict:
    if duration_type == "single":
        end = start
    assessment_dates = daterange(start, end)
    # Only the START date decides this — a continuous assessment that begins on a
    # weekday (Mon-Fri) still gets the weekend-skipping rule even if the range later
    # runs into a Saturday/Sunday. The flat "count the weekend" rule only applies
    # when the assessment itself begins on a Saturday or Sunday.
    starts_on_weekend = duration_type == "continuous" and start.weekday() >= 5
    schedule_pairs = [
        {
            "assessment_date": d.isoformat(),
            "date": schedule_reminder_for_assessment_date(d, duration_type, starts_on_weekend).isoformat(),
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
