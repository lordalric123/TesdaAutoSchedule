@echo off
cd /d "%~dp0.."
echo ================================================
echo   Starting the app on this computer...
echo ================================================
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo Python is not installed on this computer.
    echo Please install it from https://www.python.org/downloads/
    echo IMPORTANT: during install, check the box "Add Python to PATH".
    echo.
    pause
    exit /b 1
)

python -m pip install -r requirements.txt --quiet

echo.
echo Starting the app... this window must stay open while you use it.
echo Once it says "Running on http://127.0.0.1:5050", open that address
echo in your web browser.
echo.
echo To stop the app, close this window or press Ctrl+C.
echo.
python app.py
pause
