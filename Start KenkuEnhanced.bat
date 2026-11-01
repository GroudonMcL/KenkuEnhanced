@echo off
REM ==========================================================================
REM  Start KenkuEnhanced - double-click this file to run the dashboard helper.
REM  Leave the black window open while you play; close it to stop.
REM ==========================================================================
title KenkuEnhanced helper
REM Run from the folder this file lives in, wherever you put it.
cd /d "%~dp0"

REM 1. Which Node.js? The installer / release download brings its own in the
REM    "node" folder. A copy from GitHub's "Download ZIP" uses an installed one.
set "NODE=node"
if exist "%~dp0node\node.exe" (
  set "NODE=%~dp0node\node.exe"
  goto have_node
)
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed yet.
  echo  Easiest: download the installer from the Releases page instead - it includes
  echo  everything:  https://github.com/GroudonMcL/KenkuEnhanced/releases
  echo.
  echo  Or install Node.js: your browser will now open https://nodejs.org - download
  echo  the "LTS" version, install it with the default options, then double-click
  echo  this file again.
  echo.
  start "" https://nodejs.org/
  pause
  exit /b 1
)
:have_node

REM 2. First run: make your personal settings file from the template.
if not exist config.json (
  copy config.example.json config.json >nul
  echo  Created config.json with default settings.
)

REM 3. Install or update the libraries we use (quick when nothing changed).
REM    Release downloads already include them, so this is skipped there.
if exist "%~dp0node\node.exe" if exist "node_modules\express\package.json" goto start_helper
echo  Checking libraries...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo.
  echo  "npm install" failed. Check your internet connection and try again.
  pause
  exit /b 1
)

:start_helper
REM 4. Start the helper. It prints the dashboard address.
"%NODE%" helper\server.js

REM 75 = the helper closed itself to install an update. The updater starts a
REM fresh window when it's done, so this one can just close.
if "%ERRORLEVEL%"=="75" exit

REM If the server stops (or fails to start), keep the window open so you can read why.
pause
