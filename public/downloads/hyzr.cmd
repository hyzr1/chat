@echo off
setlocal EnableExtensions

if /i "%~1"=="--hyzr-console" (
  shift
  goto :console_ready
)

rem Open a dedicated PowerShell-hosted console so Windows uses its modern
rem Consolas/Cascadia font profile instead of the legacy cmd raster font.
set "HYZR_LAUNCHER=%~f0"
start "Hyzr Agent" powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$Host.UI.RawUI.WindowTitle='Hyzr Agent'; & $env:ComSpec /d /s /c ('\"' + $env:HYZR_LAUNCHER + '\" --hyzr-console'); exit $LASTEXITCODE"
exit /b

:console_ready
chcp 65001 >nul 2>nul
title Hyzr Agent
color 07

if not defined HYZR_URL set "HYZR_URL=https://chat-beta-weld.vercel.app"
set "HYZR_DIR=%USERPROFILE%\.hyzr\agent"
set "HYZR_RUNTIME=%HYZR_DIR%\hyzr-agent.mjs"
set "HYZR_BACKUP=%HYZR_DIR%\hyzr-agent.backup.mjs"
set "HYZR_RESTARTS=0"

where node.exe >nul 2>nul
if errorlevel 1 goto :missing_node
node.exe -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)"
if errorlevel 1 goto :missing_node

if not exist "%HYZR_DIR%" mkdir "%HYZR_DIR%" >nul 2>nul

echo.
echo   HYZR AGENT
echo   Updating securely...

powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';" ^
  "$base=$env:HYZR_URL.TrimEnd('/'); $dir=$env:HYZR_DIR;" ^
  "$runtime=$env:HYZR_RUNTIME; $backup=$env:HYZR_BACKUP;" ^
  "$download=Join-Path $dir 'hyzr-agent.download'; $sumFile=Join-Path $dir 'hyzr-agent.sha256.download';" ^
  "try {" ^
  "  Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -Uri ($base + '/downloads/hyzr-agent.sha256') -OutFile $sumFile;" ^
  "  Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 -Uri ($base + '/downloads/hyzr-agent.mjs') -OutFile $download;" ^
  "  $expected=((Get-Content -Raw $sumFile).Trim() -split '\s+')[0].ToLowerInvariant();" ^
  "  $actual=(Get-FileHash -Algorithm SHA256 -LiteralPath $download).Hash.ToLowerInvariant();" ^
  "  if ($expected.Length -ne 64 -or $actual -ne $expected) { throw 'The downloaded runtime failed its integrity check.' }" ^
  "  if (Test-Path -LiteralPath $runtime) { Copy-Item -Force -LiteralPath $runtime -Destination $backup }" ^
  "  Move-Item -Force -LiteralPath $download -Destination $runtime;" ^
  "  Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $sumFile;" ^
  "  exit 0" ^
  "} catch {" ^
  "  Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $download,$sumFile;" ^
  "  if (Test-Path -LiteralPath $runtime) { Write-Warning ('Update unavailable; using the verified local runtime. ' + $_.Exception.Message); exit 0 }" ^
  "  Write-Error $_.Exception.Message; exit 1" ^
  "}"
if errorlevel 1 goto :download_failed

node.exe --check "%HYZR_RUNTIME%" >nul 2>nul
if errorlevel 1 (
  if exist "%HYZR_BACKUP%" (
    copy /y "%HYZR_BACKUP%" "%HYZR_RUNTIME%" >nul
    node.exe --check "%HYZR_RUNTIME%" >nul 2>nul
  )
)
if errorlevel 1 goto :runtime_failed

:run
node.exe "%HYZR_RUNTIME%" "--url=%HYZR_URL%" %*
set "HYZR_EXIT=%ERRORLEVEL%"
if "%HYZR_EXIT%"=="0" exit /b 0
set /a HYZR_RESTARTS+=1
if %HYZR_RESTARTS% GEQ 3 goto :agent_failed
echo.
echo   Hyzr stopped unexpectedly. Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto :run

:missing_node
echo.
echo   Hyzr needs Node.js 18 or newer.
echo   Install it from https://nodejs.org and open this file again.
echo.
pause
exit /b 1

:download_failed
echo.
echo   Hyzr could not download its tiny runtime.
echo   Check your connection and open this file again.
echo.
pause
exit /b 1

:runtime_failed
echo.
echo   Hyzr protected you from a corrupt runtime update.
echo   Open this file again to retry the verified download.
echo.
pause
exit /b 1

:agent_failed
echo.
echo   Hyzr could not recover after three attempts.
echo   Run: node "%HYZR_RUNTIME%" --doctor --url="%HYZR_URL%"
echo.
pause
exit /b %HYZR_EXIT%
