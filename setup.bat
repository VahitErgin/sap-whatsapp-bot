@echo off
chcp 65001 >nul 2>&1
title SAP WhatsApp Bot — Kurulum
cd /d "%~dp0"

:: ── UAC yükseltme ────────────────────────────────────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  Yonetici yetkisi gerekiyor — UAC penceresi acilacak...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo.
echo  ================================================
echo   SAP WhatsApp Bot  ^|  Kurulum Sihirbazi
echo  ================================================
echo.

:: Node.js kontrol
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  HATA: Node.js bulunamadi.
    echo  Lutfen https://nodejs.org adresinden Node.js yukleyin.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -e "process.stdout.write(process.version)"') do set NODE_VER=%%v
echo  Node.js: %NODE_VER%

:: npm install
if not exist "node_modules\" (
    echo.
    echo  Bagimliliklar yukleniyor ^(npm install^)...
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo  HATA: npm install basarisiz oldu.
        pause
        exit /b 1
    )
)

:: Setup sihirbazi
echo.
node setup.js
echo.
pause
