from app import build_assessor_history
from excel_loader import _group_assessors, identity_key


def test_identity_key_ignores_spacing_and_case():
    assert identity_key("Juan Dela Cruz") == identity_key("  JUAN   DELA CRUZ  ")


def test_identity_key_keeps_different_accreditation_numbers_apart():
    first = identity_key("Juan Dela Cruz", accreditation="ACC-1")
    second = identity_key("Juan Dela Cruz", accreditation="ACC-2")
    assert first != second


def test_group_assessors_dedupes_name_formatting():
    rows = [
        {
            "identity_key": identity_key("Juan Dela Cruz"),
            "name": "Juan Dela Cruz",
            "source": "province",
            "address": "",
            "sex": "",
            "designation": "",
            "company": "",
            "sector": "",
            "accreditation_number": "",
            "valid_until": "",
            "qualification": "CSS NC II",
            "qualification_key": "css nc ii",
        },
        {
            "identity_key": identity_key("JUAN DELA CRUZ"),
            "name": "JUAN DELA CRUZ",
            "source": "province",
            "address": "",
            "sex": "",
            "designation": "",
            "company": "",
            "sector": "",
            "accreditation_number": "",
            "valid_until": "",
            "qualification": "CSS NC II",
            "qualification_key": "css nc ii",
        },
    ]
    grouped = _group_assessors(rows)
    assert len(grouped) == 1


def test_assessor_history_groups_counts_and_filters():
    assessments = [
        {
            "id": "1",
            "assessment_center": "Center A",
            "qualification": "Computer Systems Servicing NC II",
            "duration_type": "single",
            "start_date": "2026-09-14",
            "end_date": "2026-09-14",
            "pax": 8,
            "assessor": "Juan Dela Cruz",
            "assessor_type": "region",
            "tesda_representative": "",
            "assessment_dates": ["2026-09-14"],
            "approved_dates": [],
            "schedule_reminder_dates": [],
            "results_reminder_dates": [],
            "created_at": "",
            "updated_at": "",
        },
        {
            "id": "2",
            "assessment_center": "Center B",
            "qualification": "Computer Systems Servicing NC II",
            "duration_type": "single",
            "start_date": "2026-09-18",
            "end_date": "2026-09-18",
            "pax": 10,
            "assessor": "Juan Dela Cruz",
            "assessor_type": "region",
            "tesda_representative": "",
            "assessment_dates": ["2026-09-18"],
            "approved_dates": [],
            "schedule_reminder_dates": [],
            "results_reminder_dates": [],
            "created_at": "",
            "updated_at": "",
        },
        {
            "id": "3",
            "assessment_center": "Center C",
            "qualification": "Driving NC II",
            "duration_type": "single",
            "start_date": "2026-08-10",
            "end_date": "2026-08-10",
            "pax": 5,
            "assessor": "Maria Santos",
            "assessor_type": "province",
            "tesda_representative": "",
            "assessment_dates": ["2026-08-10"],
            "approved_dates": [],
            "schedule_reminder_dates": [],
            "results_reminder_dates": [],
            "created_at": "",
            "updated_at": "",
        },
    ]
    september = build_assessor_history(
        assessments,
        2026,
        9,
        "Computer Systems Servicing NC II",
        "region",
        "",
    )
    assert september["period_label"] == "September 2026"
    assert len(september["results"]) == 1
    assert september["results"][0]["assessor"] == "Juan Dela Cruz"
    assert september["results"][0]["assessments_conducted"] == 2

    year_only = build_assessor_history(assessments, 2026)
    names = {row["assessor"] for row in year_only["results"]}
    assert names == {"Juan Dela Cruz", "Maria Santos"}
