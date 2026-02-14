@echo off
setlocal

cd /d "%~dp0.."
title Epic Device Auth Bootstrap

echo Running Epic Device Auth bootstrap...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\epic_device_auth_bootstrap.ps1

echo.
echo Done. Press any key to close.
pause >nul

endlocal

