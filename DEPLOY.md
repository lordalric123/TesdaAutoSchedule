# Deployment Guide

This project should treat the GitHub repository as the primary source of truth for the code and its default Excel files. Render is a secondary environment for public access, not the master copy of the app data.

## Primary repo setup

The app reads and writes its default persistent data in the repository folder:

```text
data/
```

This includes:

- `data/assessments.json`
- `data/representatives.json`
- `data/settings.json`
- `data/task_status.json`
- `data/excel/assessment_centers.xlsx`
- `data/excel/competency_assessors.xlsx`
- `data/excel/region_assessors.xlsx`

This is the correct setup for a normal local workflow and for a repo-based primary copy.

## Render as secondary

Use Render only for a public deployment or backup copy.

1. Push this project to GitHub.
2. Go to https://render.com and sign in.
3. Click New > Web Service.
4. Select your GitHub repo.
5. Use these values:
   - Name: tesda-scheduler
   - Runtime: Python
   - Build command: `pip install -r requirements.txt`
   - Start command: `gunicorn wsgi:app --bind 0.0.0.0:$PORT`
6. Click Create Service.
7. Wait for deployment to finish.
8. Open the public URL Render gives you.

## Important notes

- The project data folder is the main source of truth.
- If Render is used, it should be treated as a secondary environment.
- Render does not automatically push its data back into GitHub.
- If you change data on Render, export a backup and import it into the repo version later.
- If you want the repo version to stay current, use the backup/import flow from the app after each Render update.
- The default local setup keeps data under the repo `data/` folder, which matches your requirement.

## Local setup

```bash
python -m pip install -r requirements.txt
python app.py
```

Then open:

```text
http://127.0.0.1:5050
```

## One-click launch script

On Linux/macOS:

```bash
chmod +x start.sh
./start.sh
```

On Windows:

```bat
run.bat
```
