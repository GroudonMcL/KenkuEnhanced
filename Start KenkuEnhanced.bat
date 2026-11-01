@echo off
REM ==========================================================================
REM  Start KenkuEnhanced - double-click this file to run the dashboard helper.
REM  Leave the black window open while you play; close it to stop.
REM ==========================================================================
title KenkuEnhanced helper
REM Run from the folder this file lives in, wherever you put it.
cd /d "%~dp0"

REM 1. Is Node.js installed?
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed yet.
  echo  Your browser will now open https://nodejs.org - download the "LTS" version,
  echo  install it with the default options, then double-click this file again.
  echo.
  start "" https://nodejs.org/
  pause
  exit /b 1
)

REM 2. First run: make your personal settings file from the template.
if not exist config.json (
  copy config.example.json config.json >nul
  echo  Created config.json with default settings.
)

REM 3. Install or update the libraries we use (quick when nothing changed).
echo  Checking libraries...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo.
  echo  "npm install" failed. Check your internet connection and try again.
  pause
  exit /b 1
)

REM 4. Start the helper. It prints the dashboard address.
node helper\server.js

REM If the server stops (or fails to start), keep the window open so you can read why.
pause
