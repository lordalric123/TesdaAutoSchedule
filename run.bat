@echo off
cd /d "%~dp0"
set "APP_DATA_DIR=%~dp0data"
if not exist "%APP_DATA_DIR%" mkdir "%APP_DATA_DIR%"
python -m pip install -r requirements.txt
python convert_excel_to_json.py
python app.py
