@echo off
rem SoundShape - Windows launcher: starts the backend (:8000) and the web app (:3000).
cd /d "%~dp0"
chcp 65001 >nul
set PYTHONUTF8=1
set HF_HUB_DISABLE_SYMLINKS_WARNING=1

rem Put ffmpeg on PATH (winget install location), if it isn't already.
where ffmpeg >nul 2>nul
if errorlevel 1 (
  for /d %%D in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg*") do (
    for /d %%B in ("%%D\ffmpeg-*") do set "PATH=%%B\bin;%PATH%"
  )
)

start "SoundShape backend" cmd /k venv\Scripts\python.exe -m uvicorn backend.api.main:app --port 8000
start "SoundShape frontend" cmd /k "cd frontend && npm run dev"
echo Backend: http://localhost:8000   Web app: http://localhost:3000
