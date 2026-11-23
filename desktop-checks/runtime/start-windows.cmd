@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
if errorlevel 1 goto location_error
if not exist "launcher.py" goto package_error
if not exist "manifest.json" goto package_error
set "runtime_arch=%PROCESSOR_ARCHITECTURE%"
if defined PROCESSOR_ARCHITEW6432 set "runtime_arch=%PROCESSOR_ARCHITEW6432%"
if /i "%runtime_arch%"=="ARM64" goto arm64_runtime
if /i "%runtime_arch%"=="AMD64" goto amd64_runtime
goto system_python
:arm64_runtime
if not exist "runtime\windows-arm64\python.exe" goto package_error
"runtime\windows-arm64\python.exe" -X utf8 -B "launcher.py" %*
set "launcher_result=%errorlevel%"
goto done
:amd64_runtime
if not exist "runtime\windows-amd64\python.exe" goto package_error
"runtime\windows-amd64\python.exe" -X utf8 -B "launcher.py" %*
set "launcher_result=%errorlevel%"
goto done
:system_python
call py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>&1
if not errorlevel 1 goto run_py
call python -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>&1
if not errorlevel 1 goto run_python
echo Python 3.9 or newer was not found.
echo Install Python from https://www.python.org/downloads/ and enable Add Python to PATH.
echo Then open this startup file again.
pause
exit /b 1
:run_py
call py -3 -B "launcher.py" %*
set "launcher_result=%errorlevel%"
goto done
:run_python
call python -B "launcher.py" %*
set "launcher_result=%errorlevel%"
:done
if "%launcher_result%"=="0" exit /b 0
echo.
echo Startup failed. Keep the error text above for support.
pause
exit /b %launcher_result%
:location_error
echo Cannot open the package folder. Extract the complete ZIP to a local folder.
pause
exit /b 1
:package_error
echo Missing launcher.py, manifest.json or bundled Python. Extract the complete ZIP first.
echo Keep this startup file together with launcher.py, manifest.json and the site folder.
pause
exit /b 1
