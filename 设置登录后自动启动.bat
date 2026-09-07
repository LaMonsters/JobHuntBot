@echo off
chcp 65001 >nul
cd /d "%~dp0dashboard"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0dashboard\install-autostart.ps1"
if errorlevel 1 (
  echo.
  echo 设置失败，请检查是否已安装 Node.js。
  pause
  exit /b 1
)
echo.
echo 已设置为当前 Windows 账户登录后自动启动。
pause
