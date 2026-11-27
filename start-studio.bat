@echo off
rem CineForgeAI launcher. Port 1000 only. Opens the studio in Chrome (or Edge) full screen.
rem If the studio is already running, do NOT start a second one: just open it.
rem Otherwise start the server in this terminal window.
set "STUDIO_URL=http://cineforgeai.in:1000/"

if /i "%~1"=="open" goto openbrowser

title CineForgeAI - %STUDIO_URL%
cd /d "%~dp0dashboard"
set PORT=1000

curl -s -o nul --max-time 2 %STUDIO_URL%
if not errorlevel 1 (
  echo CineForgeAI is already running on %STUDIO_URL%
  echo Opening it full screen. Not starting a second copy.
  call :openbrowser
  exit /b 0
)

echo Starting CineForgeAI on %STUDIO_URL% ...
rem wait a few seconds for the server, then open the browser full screen (separate hidden helper)
start "" /min cmd /c "ping -n 5 127.0.0.1 >nul & call "%~f0" open"
node server.js
echo.
echo The studio stopped. Press any key to close this window.
pause >nul
exit /b 0

:openbrowser
rem A dedicated profile makes Chrome start a NEW process, which honours --start-fullscreen
rem (opening a URL in an already-running Chrome ignores it). Edge is the fallback.
set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "PROFILE=%LOCALAPPDATA%\CineForgeAI\chrome-profile"
if not exist "%PROFILE%" mkdir "%PROFILE%"
start "" "%BROWSER%" --user-data-dir="%PROFILE%" --start-fullscreen --app=%STUDIO_URL%
exit /b 0
