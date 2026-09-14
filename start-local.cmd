@echo off
cd /d "%~dp0"
if not exist "node_modules\vite" (
  echo Please run npm ci in this folder first.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:5173 in your browser.
call npm run dev
pause
