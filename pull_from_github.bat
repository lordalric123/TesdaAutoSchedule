@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pull_from_github.ps1" %*

if errorlevel 1 (
    echo.
    echo ERROR: Git pull failed.
    pause
)

endlocal
