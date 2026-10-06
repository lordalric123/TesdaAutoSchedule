#!/bin/bash
cd "$(dirname "$0")/.."

echo "================================================"
echo "  Starting the app on this computer..."
echo "================================================"
echo ""

if ! command -v python3 >/dev/null 2>&1; then
    echo "Python is not installed on this computer."
    echo "Please install it from https://www.python.org/downloads/"
    echo ""
    read -p "Press Enter to close this window."
    exit 1
fi

python3 -m pip install -r requirements.txt --quiet

echo ""
echo "Starting the app... this window must stay open while you use it."
echo "Once it says 'Running on http://127.0.0.1:5050', open that address"
echo "in your web browser."
echo ""
echo "To stop the app, close this window or press Ctrl+C."
echo ""
python3 app.py
