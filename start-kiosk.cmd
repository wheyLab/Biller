@echo off
rem Whey Lab counter app: build it, start the server, and open it fullscreen
rem (kiosk mode: no address bar, tabs or window frame).
rem Double-click to run. To launch at boot, put a shortcut to this file in
rem the folder that opens with:  Win+R  ->  shell:startup
rem Exit the fullscreen app with Alt+F4. The server keeps running in a
rem minimised window titled "Whey Lab server"; close that window to stop it.
setlocal
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
set "URL=http://127.0.0.1:4173"

echo Building the app...
call npm run build >nul 2>&1
if errorlevel 1 (
  echo Build failed. Run "npm run build" in this folder to see why.
  pause
  exit /b 1
)

powershell -NoProfile -Command "if (Test-NetConnection 127.0.0.1 -Port 4173 -InformationLevel Quiet -WarningAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo Starting the server...
  start "Whey Lab server" /min cmd /c "npm start"
  powershell -NoProfile -Command "$i=0; while (-not (Test-NetConnection 127.0.0.1 -Port 4173 -InformationLevel Quiet -WarningAction SilentlyContinue) -and $i -lt 60) { Start-Sleep 1; $i++ }"
)

rem The pushup leaderboard is a separate app that the idle screensaver shows.
rem Started here if it sits next to this folder (override with PUSHUP_DIR).
rem Without it, the screensaver just plays the offers and reels.
if not defined PUSHUP_DIR set "PUSHUP_DIR=%~dp0..\pushup-challenge"
if exist "%PUSHUP_DIR%\package.json" (
  powershell -NoProfile -Command "if (Test-NetConnection 127.0.0.1 -Port 4180 -InformationLevel Quiet -WarningAction SilentlyContinue) { exit 0 } else { exit 1 }"
  if errorlevel 1 (
    echo Starting the pushup leaderboard...
    pushd "%PUSHUP_DIR%"
    call npm run build >nul 2>&1
    start "Pushup server" /min cmd /c "npm start"
    popd
  )
)

rem A separate browser profile keeps kiosk state (and "restore tabs" prompts)
rem out of the browser you use for everything else.
set "PROFILE=%LOCALAPPDATA%\WheyLabKiosk"
set "CHROME1=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "CHROME2=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
set "EDGE1=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE2=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "COMMON=--user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --disable-infobars --noerrdialogs --disable-session-crashed-bubble --disable-pinch --overscroll-history-navigation=0"

set "BROWSER="
if exist "%CHROME1%" set "BROWSER=%CHROME1%" & set "ARGS=--kiosk %COMMON% "%URL%""
if not defined BROWSER if exist "%CHROME2%" set "BROWSER=%CHROME2%" & set "ARGS=--kiosk %COMMON% "%URL%""
if not defined BROWSER if exist "%EDGE1%" set "BROWSER=%EDGE1%" & set "ARGS=--kiosk %COMMON% --edge-kiosk-type=fullscreen "%URL%""
if not defined BROWSER if exist "%EDGE2%" set "BROWSER=%EDGE2%" & set "ARGS=--kiosk %COMMON% --edge-kiosk-type=fullscreen "%URL%""
if not defined BROWSER (
  echo Could not find Chrome or Edge.
  pause
  exit /b 1
)

if defined KIOSK_DRY_RUN (
  echo DRY RUN - would launch: "%BROWSER%" %ARGS%
  exit /b 0
)
start "" "%BROWSER%" %ARGS%
