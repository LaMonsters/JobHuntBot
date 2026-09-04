@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0start-dashboard-background.ps1"
if errorlevel 1 (
  echo OfferTrack could not start. Check the message above.
  pause
  exit /b 1
)
start "" "http://localhost:8420/dashboard.html"
