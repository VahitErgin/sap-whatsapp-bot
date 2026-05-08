@echo off
chcp 65001 >nul 2>&1
title SAP WhatsApp Bot — Güncelleme
cd /d "%~dp0"

:: ── UAC yükseltme ─────────────────────────────────────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  Yonetici yetkisi gerekiyor — UAC penceresi acilacak...
    powershell -Command "Start-Process '%~f0' -ArgumentList '%*' -Verb RunAs"
    exit /b
)

echo.
echo  ================================================
echo   SAP WhatsApp Bot  ^|  Guncelleme
echo  ================================================
echo.

:: ── Zip dosyasını bul ─────────────────────────────────────────
set "ZIP_FILE=%~1"

if "%ZIP_FILE%"=="" (
    :: Argüman verilmemişse klasördeki ilk sawbot-*.zip'i al
    for /f "delims=" %%f in ('dir /b /o-d "sawbot-*.zip" 2^>nul') do (
        set "ZIP_FILE=%%f"
        goto :found
    )
    echo  HATA: Zip dosyasi bulunamadi.
    echo  Kullanim: update.bat sawbot-v1.1.zip
    echo  veya zip dosyasini bu klasore koyup tekrar calistirin.
    echo.
    pause
    exit /b 1
)

:found
if not exist "%ZIP_FILE%" (
    echo  HATA: "%ZIP_FILE%" bulunamadi.
    pause
    exit /b 1
)

echo  Guncelleme dosyasi: %ZIP_FILE%
echo.

:: ── Mevcut versiyon bilgisi ────────────────────────────────────
if exist "package.json" (
    for /f "tokens=2 delims=:, " %%v in ('findstr /i "\"version\"" package.json') do (
        set "OLD_VER=%%~v"
        goto :gotver
    )
)
:gotver
if defined OLD_VER echo  Mevcut versiyon : %OLD_VER%
echo.

:: ── Servisi durdur ────────────────────────────────────────────
echo  [1/4] Servis durduruluyor...
powershell -NonInteractive -Command "
    $task = Get-ScheduledTask -TaskName 'SAP WhatsApp Bot' -ErrorAction SilentlyContinue
    if ($task) {
        Stop-ScheduledTask -TaskName 'SAP WhatsApp Bot' -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
        Write-Output 'OK'
    } else {
        Write-Output 'NOTFOUND'
    }
" > "%TEMP%\sawbot_task.tmp" 2>&1
set /p TASK_STATUS=<"%TEMP%\sawbot_task.tmp"

if "%TASK_STATUS%"=="OK" (
    echo  Zamanlanmis gorev durduruldu.
) else if "%TASK_STATUS%"=="NOTFOUND" (
    echo  Zamanlanmis gorev bulunamadi ^(manuel calistiriliyor olabilir^).
) else (
    echo  Servis zaten durmus veya bulunamadi.
)
echo.

:: ── .env ve data/ yedekle ─────────────────────────────────────
echo  [2/4] Kritik dosyalar yedekleniyor...

if exist ".env" (
    copy /y ".env" ".env.backup" >nul
    echo  .env yedeklendi ^(.env.backup^)
)
if exist "data\" (
    echo  data/ klasoru zip disinda — dokunulmuyor.
)
echo.

:: ── Yeni dosyaları aç ─────────────────────────────────────────
echo  [3/4] Yeni dosyalar aciliyor...
powershell -NonInteractive -Command "
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip  = [System.IO.Path]::GetFullPath('%ZIP_FILE%')
    $dest = [System.IO.Path]::GetFullPath('.')
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
    foreach ($entry in $archive.Entries) {
        if ($entry.FullName -match '/$') { continue }
        \$target = Join-Path $dest $entry.FullName
        \$dir = Split-Path $target
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
    }
    $archive.Dispose()
    Write-Output 'OK'
" 2>&1
if %errorlevel% neq 0 (
    echo  HATA: Dosyalar acilamadi.
    if exist ".env.backup" copy /y ".env.backup" ".env" >nul
    pause
    exit /b 1
)
echo  Dosyalar basariyla guncellendi.
echo.

:: ── npm install ────────────────────────────────────────────────
echo  [4/4] Bagimliliklar guncelleniyor ^(npm install^)...
call npm install --omit=dev --prefer-offline 2>&1
if %errorlevel% neq 0 (
    echo  UYARI: npm install hata verdi. Bagimliliklarla ilgili sorun olabilir.
)
echo.

:: ── Yeni versiyon bilgisi ──────────────────────────────────────
if exist "package.json" (
    for /f "tokens=2 delims=:, " %%v in ('findstr /i "\"version\"" package.json') do (
        set "NEW_VER=%%~v"
        goto :gotnewver
    )
)
:gotnewver

:: ── Servisi yeniden başlat ─────────────────────────────────────
powershell -NonInteractive -Command "
    $task = Get-ScheduledTask -TaskName 'SAP WhatsApp Bot' -ErrorAction SilentlyContinue
    if ($task) {
        Start-ScheduledTask -TaskName 'SAP WhatsApp Bot'
        Write-Output 'STARTED'
    } else {
        Write-Output 'NOTFOUND'
    }
" > "%TEMP%\sawbot_task2.tmp" 2>&1
set /p START_STATUS=<"%TEMP%\sawbot_task2.tmp"

echo  ================================================
if defined OLD_VER if defined NEW_VER (
    echo   %OLD_VER%  →  %NEW_VER%
)
echo   Guncelleme tamamlandi!
echo  ================================================
echo.

if "%START_STATUS%"=="STARTED" (
    echo  Servis yeniden baslatildi.
    echo  Kontrol: http://localhost:3000/admin
) else (
    echo  Servisi manuel baslatin:
    echo    start.bat  veya  node src/index.js
)

echo.
del "%TEMP%\sawbot_task.tmp"  >nul 2>&1
del "%TEMP%\sawbot_task2.tmp" >nul 2>&1
pause
