@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
  node server.mjs
  goto :end
)

set "BUNDLED_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%BUNDLED_NODE%" (
  "%BUNDLED_NODE%" server.mjs
  goto :end
)

echo Node.js 20 or later is required.
echo Please install Node.js, then run this file again.
pause

:end
endlocal
