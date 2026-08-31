@echo off
cd /d "%~dp0"

set PM2PID=
for /f "delims=" %%p in ('pm2 pid spending 2^>nul') do set PM2PID=%%p

if defined PM2PID (
    if not "%PM2PID%"=="0" (
        echo === spending is already running, pid %PM2PID%. Stopping... ===
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

set PORT=3000

echo.
echo === start with pm2 ===
call pm2 start server.js --name spending

echo.
echo === detecting local IP ===
set LOCAL_IP=
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' -and $_.InterfaceAlias -notmatch 'Loopback|vEthernet|Virtual|Bluetooth' } | Sort-Object InterfaceMetric | Select-Object -First 1 -ExpandProperty IPAddress)"') do set LOCAL_IP=%%i
if not defined LOCAL_IP set LOCAL_IP=localhost

timeout /t 2 /nobreak >nul
start "" "http://%LOCAL_IP%:%PORT%"

echo.
echo Server is running under pm2.
echo   address: http://%LOCAL_IP%:%PORT%
echo   status:  pm2 status
echo   logs:    pm2 logs spending
echo.
pause
