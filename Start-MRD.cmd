@echo off
setlocal
cd /d "%~dp0"
title Mini Remote Desktop

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\check-single-instance.ps1"
if errorlevel 1 goto :fail

rem Always restart the managed Node host so a git pull immediately loads the
rem current backend code instead of leaving an older server process running.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-mrd-host.ps1"
if errorlevel 1 goto :fail

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-all.ps1"
if errorlevel 1 goto :fail

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\check-single-instance.ps1"
if errorlevel 1 goto :fail

echo.
echo MRD startup completed successfully.
timeout /t 5 >nul
exit /b 0

:fail
echo.
echo MRD startup failed. Review the error above.
echo.
pause
exit /b 1
