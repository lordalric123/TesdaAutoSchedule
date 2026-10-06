# TESDA Competency Assessment Scheduler

Browser-based scheduler for TESDA Southern Leyte competency assessments. Enter assessment details once; the system calculates approved/portal schedule dates, results reminders, calendars, and monthly Excel exports.

## Run

```bat
run.bat
```

Or:

```bat
python -m pip install -r requirements.txt
python app.py
```

Then open http://127.0.0.1:5050

## Data sources

Default Excel files are in `data/excel/`:

- `assessment_centers.xlsx` — schools / accredited assessment centers and qualifications
- `competency_assessors.xlsx` — province-based competency assessors
- `region_assessors.xlsx` — region-based competency assessors (upload from Settings if needed)

Replace them from **Settings / Data Sources** without restarting the app, then refresh. Theme colors are also saved there.
