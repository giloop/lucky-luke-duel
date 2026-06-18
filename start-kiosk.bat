@echo off
cd /d "c:\dev\lucky-luke-duel"

REM Kill any existing Chrome using the kiosk profile
taskkill /f /im chrome.exe >nul 2>&1

REM Kill any existing Vite dev server (node process on port 3000)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /f /pid %%p >nul 2>&1
)

REM Start the Vite dev server in a minimized window
start /min "Lucky Luke Dev Server" cmd /c "pnpm dev"

REM Wait until port 3000 is accepting connections
echo Waiting for server to start...
:wait
timeout /t 1 /nobreak >nul
powershell -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('localhost', 3000); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto wait

REM Find Chrome and launch in kiosk mode
set CHROME=
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
)

set PROFILE=C:\chrome-kiosk-profile

if "%CHROME%"=="" (
    echo Chrome not found. Opening in default browser instead.
    start "" "http://localhost:3000/lucky-luke-duel/"
) else (
    REM Clean profile to avoid session restore dialogs that break kiosk mode
    rmdir /s /q "%PROFILE%" 2>nul

    REM start "" "%CHROME%" --start-fullscreen --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --disable-extensions "http://localhost:3000/lucky-luke-duel/"
    start "" "%CHROME%" "http://localhost:3000/lucky-luke-duel/" --kiosk --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --disable-extensions
)