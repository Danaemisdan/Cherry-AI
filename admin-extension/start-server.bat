@echo off
REM Double-click to start license server on Windows
cd /d "%~dp0"

echo Starting License Server... > server.log
echo Starting License Server...
echo.

:: Try python3 first, then python
python3 --version >nul 2>&1
if %errorlevel% == 0 (
    echo Found python3 >> server.log
    python3 license-server.py 2>> server.log
) else (
    python --version >nul 2>&1
    if %errorlevel% == 0 (
        echo Found python >> server.log
        python license-server.py 2>> server.log
    ) else (
        echo ERROR: Python is not installed or not in PATH
        echo ERROR: Python not found >> server.log
        echo Please install Python 3 from https://python.org
        pause
        exit /b 1
    )
)

echo.
echo Server stopped. Check server.log for errors.
echo Server stopped >> server.log
pause
