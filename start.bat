@echo off
setlocal enableextensions
cd /d "%~dp0"

if not exist ".env.local" (
  echo.
  echo   .env.local is missing. Copy .env.example to .env.local and fill it in.
  echo     copy .env.example .env.local
  echo.
  exit /b 1
)

where pnpm >nul 2>&1
if errorlevel 1 (
  echo.
  echo   pnpm is not installed. Install Node 24+ from nodejs.org then run:
  echo     corepack enable ^&^& corepack prepare pnpm@9.15.4 --activate
  echo.
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo   installing dependencies (first run)...
  call pnpm install || exit /b 1
)

if not exist "data\financial-coach.db" (
  echo.
  echo   running database migrations...
  call pnpm db:migrate || exit /b 1
)

if not defined HOST set HOST=127.0.0.1
if not defined PORT set PORT=3000

echo.
echo   starting Financial Coach at http://%HOST%:%PORT%
echo.

start "" "http://%HOST%:%PORT%"

if exist ".next\BUILD_ID" (
  call pnpm start
) else (
  call pnpm dev
)
