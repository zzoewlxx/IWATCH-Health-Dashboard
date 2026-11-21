@echo off
rem One-click update: reads the newest Apple Health export under the data folder,
rem rebuilds dashboard\data.js and opens the dashboard. (ASCII only on purpose:
rem cmd.exe reads .bat files in the system code page.)
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install Python 3.9+ from https://www.python.org/ and tick "Add python.exe to PATH".
  pause
  exit /b 1
)

rem Windows has no built-in time-zone database; Python needs the tzdata package for it.
python -c "import zoneinfo; zoneinfo.ZoneInfo('Asia/Shanghai')" >nul 2>nul
if errorlevel 1 (
  echo Installing the tzdata package ^(one time^)...
  python -m pip install --quiet tzdata
)

python "%~dp0pipeline\update.py" %*
if errorlevel 1 (
  echo.
  echo Update failed - see the message above.
  pause
  exit /b 1
)
echo.
echo Done. This window closes in 8 seconds.
timeout /t 8 >nul 2>nul
exit /b 0
