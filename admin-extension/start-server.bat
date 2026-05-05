@echo off
REM Double-click to start license server on Windows

cd /d "%~dp0"
python license-server.py
pause
