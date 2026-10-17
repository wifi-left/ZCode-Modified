@echo off
chcp 65001 >nul
REM ZCode CLI 一键构建并安装（Windows）。双击本文件即可运行。
REM 安装到 %USERPROFILE%\.zcode-local，不触碰运行中的桌面版与 %USERPROFILE%\.zcode。
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-zcode-cli-windows.ps1" %*
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" (
  echo 安装失败，退出码 %EXITCODE%。
) else (
  echo 安装完成。新开终端后可直接运行 zcode。
)
pause
exit /b %EXITCODE%
