@echo off
setlocal
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\set-discover-metrics-profile.ps1 %*
endlocal
