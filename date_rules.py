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


def adjust_weekend_for_single_day(reminder: date) -> date:
    """Move Saturday/Sunday reminders to the preceding weekday.

    Saturday -> Thursday
    Sunday -> Friday
    """
    weekday = reminder.weekday()  # Mon=0 ... Sat=5 Sun=6
    if weekday == 5:  # Saturday
        return reminder - timedelta(days=2)
    if weekday == 6:  # Sunday
        return reminder - timedelta(days=2)
    return reminder


def schedule_reminder_for_assessment_date(assessment_date: date, duration_type: DurationType) -> date:
    reminder = assessment_date - timedelta(days=2)
    if duration_type == "single":
        return adjust_weekend_for_single_day(reminder)
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
