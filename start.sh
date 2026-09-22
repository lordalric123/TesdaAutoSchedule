#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
export APP_DATA_DIR="${APP_DATA_DIR:-$(pwd)/data}"
mkdir -p "$APP_DATA_DIR"
python -m pip install -r requirements.txt
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-5050}"
python -m gunicorn wsgi:app --bind "${HOST}:${PORT}" --workers 2
