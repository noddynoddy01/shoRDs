@echo off
title shoRDs Research OS — Desktop Application
echo ======================================================================
echo          Launching shoRDs Desktop Application (Laptop / Desktop)
echo ======================================================================
echo.

cd /d "%~dp0"

echo [1/2] Verifying desktop bundle...
if not exist "dist\index.html" (
    echo Building latest desktop bundle from source...
    call npm run desktop:build
)

echo [2/2] Launching native Desktop window...
call npx electron desktop/main.js

pause
