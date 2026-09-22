#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
python -m pip install -r requirements.txt
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-5050}"
python -m gunicorn wsgi:app --bind "${HOST}:${PORT}" --workers 2
