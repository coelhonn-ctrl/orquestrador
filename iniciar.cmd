@echo off
rem Singularize Orquestrador: instala o que falta na primeira vez, sobe o servidor e abre o navegador.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Precisa do Node.js 18 ou mais novo: https://nodejs.org
  pause
  exit /b 1
)
set NODEV=0
for /f "tokens=1 delims=v." %%v in ('node -v') do set NODEV=%%v
if %NODEV% LSS 18 (
  echo O app precisa do Node.js 18 ou mais novo ^(encontrado: %NODEV%^). https://nodejs.org
  pause
  exit /b 1
)

if not exist .env copy .env.exemplo .env >nul
if not exist node_modules (
  echo Instalando dependencias, so na primeira vez...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
)


node src\server.js --abrir
pause
