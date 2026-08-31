@echo off
cd /d "%~dp0"

set PM2PID=
for /f "delims=" %%p in ('pm2 pid spending 2^>nul') do set PM2PID=%%p

if defined PM2PID (
    if not "%PM2PID%"=="0" (
        echo === spending is already running (pid %PM2PID%). Stopping... ===
        call pm2 delete spending
        echo.
        echo Stopped.
        echo.
        pause
        exit /b 0
    )
)

echo === spending is not running. Starting... ===

echo.
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
echo === start with pm2 ===
call pm2 start server.js --name spending

echo.
echo Server is running under pm2.
echo   status: pm2 status
echo   logs:   pm2 logs spending
echo.
pause
