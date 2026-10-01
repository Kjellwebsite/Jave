@echo off
rem JAVE Agent: double-click to start. Works in your user folder; uses the
rem Node.js that the JAVE installer put in %USERPROFILE%\JAVE\node if needed.
setlocal
if defined JAVE_HOME (set "PATH=%JAVE_HOME%\node;%PATH%") else (set "PATH=%USERPROFILE%\JAVE\node;%PATH%")
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js fehlt. Zuerst JAVE installieren, siehe START-HIER.md
  pause
  exit /b 1
)
cd /d "%USERPROFILE%"
node "%~dp0agent.mjs" %*
pause
