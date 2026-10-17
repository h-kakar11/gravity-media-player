@echo off
rem One-click launcher: installs and builds Gravity only when needed, then opens it. Run it again after "git pull".
cd /d "%~dp0"
where node >nul 2>nul || (echo Gravity needs Node.js 22 or newer: https://nodejs.org & pause & exit /b 1)
node scripts\launch.mjs %*
if errorlevel 1 pause
