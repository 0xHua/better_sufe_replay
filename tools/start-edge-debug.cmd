@echo off
setlocal
title SUFE replay - Edge debug launcher
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
set "PROFILE=%LOCALAPPDATA%\sufe-replay-debug"
set "PORT=9222"

echo === SUFE replay: launch Edge with remote debugging ===
echo.

if not exist "%EDGE%" goto :noedge
if not exist "%PROFILE%" mkdir "%PROFILE%"

echo [1] Edge    : %EDGE%
echo [2] profile : %PROFILE%
echo [3] port    : %PORT%
echo.
echo     launching...
echo.

start "" "%EDGE%" --remote-debugging-port=%PORT% --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --disable-features=msEdgeFirstRunExperience

timeout /t 8 /nobreak >nul

netstat -ano | findstr ":%PORT%" >nul
if errorlevel 1 goto :noport

echo [OK] port %PORT% is listening - Edge is running with debugging enabled.
echo.
echo      Now in the NEW Edge window:
echo        1. open dm.sufe.edu.cn and log in
echo        2. open a course replay page
echo        3. press play
echo      Then tell the assistant to start capture.
echo.
echo      You can leave this window open (it does nothing more).
echo.
pause
exit /b 0

:noport
echo [FAIL] port %PORT% is NOT listening - Edge did not stay up.
echo.
echo        Possible reasons:
echo          - a window using this profile is already open
echo          - Edge updated and sits somewhere else
echo.
if exist "%PROFILE%\DevToolsActivePort" echo [info] DevToolsActivePort exists:
if exist "%PROFILE%\DevToolsActivePort" type "%PROFILE%\DevToolsActivePort"
echo.
echo        Try closing every Edge window and run this file again.
echo.
pause
exit /b 1

:noedge
echo [FAIL] Edge not found at:
echo        %EDGE%
echo        Edit the EDGE line at the top of this file.
echo.
pause
exit /b 1
