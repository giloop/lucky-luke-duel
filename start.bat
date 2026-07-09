@echo off
cd /d "%~dp0"
start "" npx vite preview --config vite.dev.config.ts
REM pnpm preview
timeout /t 2 /nobreak
REM kiosk est plus restrictif que fullscreen, il ne permet pas de changer d'onglet ni de quitter le navigateur. Il est donc plus adapté à un usage "borne" ou "exposition".
REM start "" "chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required http://localhost:4173/lucky-luke-duel/
start "" "chrome.exe" --start-fullscreen --autoplay-policy=no-user-gesture-required http://localhost:4173/lucky-luke-duel/
