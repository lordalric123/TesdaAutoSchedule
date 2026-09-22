@echo off
setlocal
cd /d "%~dp0"
set "RENDER_URL=%~1"
if "%RENDER_URL%"=="" (
  set /p RENDER_URL="Paste your Render app URL (example: https://tesda-scheduler.onrender.com): "
)
if "%RENDER_URL%"=="" (
  echo No Render URL provided.
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pull_from_render.ps1" -RenderUrl "%RENDER_URL%"
if errorlevel 1 (
  echo.
  echo Download or restore failed.
  pause
  exit /b 1
)
endlocal
