@echo off
setlocal
title Hyzr
set "HYZR_URL=https://chat-beta-weld.vercel.app"
set "HYZR_DIR=%USERPROFILE%\.hyzr\agent"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Hyzr needs Node.js 18 or newer.
  echo Install it from https://nodejs.org and open this file again.
  echo.
  pause
  exit /b 1
)

if not exist "%HYZR_DIR%" mkdir "%HYZR_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -UseBasicParsing -Uri ($env:HYZR_URL + '/downloads/hyzr-agent.mjs') -OutFile ($env:HYZR_DIR + '\hyzr-agent.tmp'); Move-Item -Force ($env:HYZR_DIR + '\hyzr-agent.tmp') ($env:HYZR_DIR + '\hyzr-agent.mjs') } catch { if (-not (Test-Path ($env:HYZR_DIR + '\hyzr-agent.mjs'))) { Write-Error $_; exit 1 } }"
if errorlevel 1 (
  echo.
  echo Hyzr could not download its tiny runtime. Check your connection and try again.
  echo.
  pause
  exit /b 1
)

node "%HYZR_DIR%\hyzr-agent.mjs" "--url=%HYZR_URL%"
if errorlevel 1 (
  echo.
  pause
)
