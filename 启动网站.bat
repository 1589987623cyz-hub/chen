@echo off
chcp 65001 >nul
cd /d "%~dp0app"
if not exist node_modules (
  set npm_config_cache=%CD%\.npm-cache
  call npm install
)
echo EX-SENSE: http://localhost:5180
call npm run dev -- --port 5180 --open
pause
