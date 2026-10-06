@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0push_to_github.ps1" %*

if errorlevel 1 (
    echo.
    echo ERROR: Git push failed.
    pause
)

endlocal
