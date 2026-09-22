@echo off
cd /d "%~dp0"
set "APP_DATA_DIR=%USERPROFILE%\TesdaAutoScheduleData"
if not exist "%APP_DATA_DIR%" mkdir "%APP_DATA_DIR%"
python -m pip install -r requirements.txt
python app.py
