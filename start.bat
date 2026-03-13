@echo off
REM NBPI - Windows Start Script
REM Double-click this file to start the app

cd /d "%~dp0"
echo Starting NBPI...
echo.

set PORT=4648

echo Server will run at http://localhost:%PORT%
echo Press Ctrl+C to stop
echo.
npx -y serve -l %PORT%
