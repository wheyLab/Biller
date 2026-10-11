@echo off
rem Whey Lab: take a dated snapshot of the database into backups/, ready for
rem you to review and push to git yourself. Double-click to run.
rem Run this whenever you want one — no schedule, no need to run it daily.
rem Each run makes a NEW file (never overwrites one), named with the date
rem range since your last snapshot.
setlocal
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"

call npm run snapshot
if errorlevel 1 (
  echo.
  echo Backup failed — see the error above.
  pause
  exit /b 1
)

echo.
pause
