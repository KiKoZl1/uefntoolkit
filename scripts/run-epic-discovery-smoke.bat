@echo off
setlocal
cd /d %~dp0..

echo Running Epic Discovery smoke test...
echo.

REM Uses Windows PowerShell 5+; bypasses execution policy for this run only.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\\epic_discovery_smoke.ps1"

set code=%ERRORLEVEL%
echo.
if not "%code%"=="0" (
  echo Script failed with exit code %code%.
  echo.
  pause
)
exit /b %code%
