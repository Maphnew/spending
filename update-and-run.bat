@echo off
cd /d "%~dp0"

echo === git pull ===
git pull
if errorlevel 1 (
    echo git pull failed. See messages above.
    pause
    exit /b 1
)

echo.
echo === npm install ===
call npm install
if errorlevel 1 (
    echo npm install failed. See messages above.
    pause
    exit /b 1
)

echo.
echo === restart with pm2 ===
call pm2 delete spending >nul 2>&1
call pm2 start server.js --name spending

echo.
echo Server is running under pm2.
echo   status: pm2 status
echo   logs:   pm2 logs spending
echo.
pause
