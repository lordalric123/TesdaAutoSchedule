# Deployment Guide

This app already works as a standard Flask project. For a free public web deployment, use Render or Railway.

## Recommended free option: Render

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

- The app stores all data under the `data/` folder. On a free host, this may reset during rebuilds unless the host supports a persistent disk or volume.
- If the platform supports persistent storage, point `APP_DATA_DIR` to that mounted folder.
- If the host does not support persistence, export backups from the app and import them after deploy.

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
