@echo off
title Que no caiga - Servidor
echo ==========================================
echo    INICIANDO EL JUEGO: QUE NO CAIGA
echo ==========================================
echo.

REM Comprobar si node_modules existe
if not exist node_modules (
    echo [INFO] No se detectaron las dependencias. Instalando...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Hubo un problema instalando las dependencias. 
        echo Aseguate de tener Node.js instalado.
        pause
        exit /b %errorlevel%
    )
)

REM Abrir el navegador en la URL local
echo [INFO] Abriendo el juego en tu navegador...
start "" "http://localhost:3000"

echo.
echo [OK] Servidor en marcha. 
echo [!] MANTEN ESTA VENTANA ABIERTA PARA PODER JUGAR.
echo.
echo ==========================================
echo.

REM Ejecutar el servidor
npm start

pause
