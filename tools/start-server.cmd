@echo off
setlocal
cd /d "%~dp0"

set "NODE=node"
where node >nul 2>nul
if errorlevel 1 set "NODE=C:\Users\0x0\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

"%NODE%" serve.js

echo.
echo server stopped
pause