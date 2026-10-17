@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-zcode-desktop-windows.ps1" %*
echo.
pause
