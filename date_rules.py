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


def _skip_weekend_two_days_before(assessment_date: date) -> date:
    """2 calendar days before, and if THAT result lands on a weekend, pushed
    back 2 more days so it always lands on a weekday.

    This is deliberately NOT "2 business days before assessment_date" — those
    are different when assessment_date itself falls on a weekend. E.g. for a
    Sunday assessment date, counting business days back from the Sunday itself
    over-shoots; the correct reminder is simply (date - 2), checked once.
    """
    reminder = assessment_date - timedelta(days=2)
    if reminder.weekday() >= 5:  # Saturday or Sunday
        reminder -= timedelta(days=2)
    return reminder


def schedule_reminder_for_assessment_date(
    assessment_date: date,
    duration_type: DurationType,
    use_flat_rule: bool = False,
) -> date:
    if duration_type == "continuous" and use_flat_rule:
        # A continuous assessment whose range touches a weekend, and which does
        # NOT begin on a Monday or Tuesday: count Sat/Sun normally — flat 2
        # calendar days before, no skipping.
        return assessment_date - timedelta(days=2)
    # Default: single-day assessments always; continuous assessments that don't
    # touch a weekend at all; and continuous assessments that touch a weekend
    # but begin on a Monday or Tuesday (the one exception that keeps the
    # skip-weekend rule even though the range runs into the weekend).
    return _skip_weekend_two_days_before(assessment_date)


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
    # The flat "count the weekend" rule only kicks in for a continuous assessment
    # whose range actually touches a Saturday or Sunday — AND only when it doesn't
    # begin on a Monday or Tuesday. A Monday/Tuesday start is the one exception
    # that keeps the business-day skip rule even though the range runs into a
    # weekend. This is an all-or-nothing flag for the whole assessment, applied to
    # every date in its range.
    touches_weekend = duration_type == "continuous" and any(d.weekday() >= 5 for d in assessment_dates)
    use_flat_rule = touches_weekend and start.weekday() not in (0, 1)  # not Monday(0) or Tuesday(1)
    schedule_pairs = [
        {
            "assessment_date": d.isoformat(),
            "date": schedule_reminder_for_assessment_date(d, duration_type, use_flat_rule).isoformat(),
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
