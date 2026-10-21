@echo off
rem Whey Lab TEST instance: its own database and its own ports, completely
rem separate from the live kiosk — safe to break, reseed or reset without
rem touching production data or the running server.
rem Double-click to run; close the window (or Ctrl+C) to stop.
rem   Order screen: http://127.0.0.1:5174   Admin: http://127.0.0.1:5174/admin
rem   API server:   http://127.0.0.1:4174
setlocal
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"

rem Separate DB file; the "test" instance uses its own fixed ports from ports.json
rem (4174/5174) — never the production ones (4173/5173).
set "WHEYLAB_DB=%LOCALAPPDATA%\WheyLabTest\wheylab-test.sqlite"
set "WHEYLAB_INSTANCE=test"

echo Test DB: %WHEYLAB_DB%
echo Seeding it with the current menu/protein data (safe to re-run)...
call npm run seed
if errorlevel 1 (
  echo Seeding failed. See the error above.
  pause
  exit /b 1
)

echo.
echo Starting the test server + client...
echo   Order screen: http://127.0.0.1:5174
echo   Admin:        http://127.0.0.1:5174/admin
echo.
call npm run dev
