@echo off
rem One-click update: reads the newest Apple Health export under the data folder,
rem rebuilds dashboard\data.js and opens the dashboard. (ASCII only on purpose:
rem cmd.exe reads .bat files in the system code page.)
setlocal
cd /d "%~dp0"

rem Find Python 3.9+. "python" may be the Microsoft Store placeholder, which is on PATH
rem but cannot run anything; the "py" launcher from python.org works even when the
rem installer's "Add python.exe to PATH" box was left unticked.
set "PY="
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>nul
if not errorlevel 1 set "PY=python"
if not defined PY (
  py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>nul
  if not errorlevel 1 set "PY=py -3"
)
if not defined PY (
  echo Python 3.9 or newer was not found.
  echo Install it from https://www.python.org/downloads/ and run this file again.
  echo On the first screen of the installer, tick "Add python.exe to PATH".
  pause
  exit /b 1
)

rem Windows has no built-in time-zone database; Python needs the tzdata package for it.
%PY% -c "import zoneinfo; zoneinfo.ZoneInfo('Asia/Shanghai')" >nul 2>nul
if errorlevel 1 (
  echo Installing the tzdata package ^(one time, needs internet^)...
  %PY% -m pip install --quiet tzdata
)

%PY% "%~dp0pipeline\update.py" %*
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
