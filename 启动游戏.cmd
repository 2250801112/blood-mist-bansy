@echo off
setlocal
cd /d "%~dp0" || exit /b 1
where python >nul 2>nul
if errorlevel 1 (
    echo Install Python 3.10 or later and add it to PATH.
    pause
    exit /b 1
)
python -X utf8 tools\play.py --open
if errorlevel 1 pause
