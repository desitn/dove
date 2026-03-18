@echo off
setlocal enabledelayedexpansion

echo ========================================
echo   Firmware CLI Tool - Environment Setup
echo ========================================
echo.

REM Get script directory
set SCRIPT_DIR=%~dp0

REM Check if firmware-cli.exe exists
if not exist "%SCRIPT_DIR%firmware-cli.exe" (
    echo [ERROR] firmware-cli.exe not found
    echo Path: %SCRIPT_DIR%firmware-cli.exe
    pause
    exit /b 1
)

echo [CHECK] firmware-cli.exe exists: %SCRIPT_DIR%firmware-cli.exe
echo.

REM Clean SCRIPT_DIR - remove trailing backslash and quotes
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "SCRIPT_DIR=%SCRIPT_DIR:"=%"

REM Check if already in PATH (clean comparison)
set "CHECK_PATH=%PATH:"=%"
echo %CHECK_PATH% | find /i "%SCRIPT_DIR%" >nul 2>nul
if %errorlevel% equ 0 (
    echo [INFO] firmware-cli is already in current session PATH
) else (
    echo [INFO] firmware-cli is not in current session PATH
)

REM Read current user PATH and clean it
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v PATH 2^>nul') do set CURRPATH=%%b

REM Remove quotes from current path
if defined CURRPATH (
    set "CURRPATH=%CURRPATH:"=%"
)

REM Check if already in user PATH
if defined CURRPATH (
    echo %CURRPATH% | find /i "%SCRIPT_DIR%" >nul 2>nul
    if %errorlevel% equ 0 (
        echo.
        echo [SUCCESS] firmware-cli has been added to user PATH environment variable
        echo Path: %SCRIPT_DIR%
        echo.
        echo You can now use firmware-cli command in any command line window
        goto :SHOW_HELP
    )
)

REM Add to user PATH (without quotes)
echo.
echo [ACTION] Adding firmware-cli to user PATH...
if defined CURRPATH (
    setx PATH "%CURRPATH%;%SCRIPT_DIR%" >nul 2>&1
) else (
    setx PATH "%SCRIPT_DIR%" >nul 2>&1
)

if %errorlevel% equ 0 (
    echo [SUCCESS] Added %SCRIPT_DIR% to user PATH
    echo.
    echo Note: New environment variables will take effect in new command line windows
    echo Current window has temporarily added PATH, ready to use
    REM Refresh current session PATH
    set "PATH=%SCRIPT_DIR%;%PATH%"
) else (
    echo [WARNING] setx failed, may require administrator privileges
    echo Please try manually adding the following path to system PATH:
    echo %SCRIPT_DIR%
)

:SHOW_HELP
echo.
echo ========================================
echo   firmware-cli Usage Help
echo ========================================
echo.
echo Available commands:
echo   firmware-cli flash            - Flash firmware (auto-detect)
echo   firmware-cli flash ^<path^>    - Flash specified firmware
echo   firmware-cli list             - List available firmwares
echo   firmware-cli devices          - List USB devices
echo   firmware-cli build            - Build firmware
echo   firmware-cli build-and-flash  - Build and flash
echo   firmware-cli config           - View configuration
echo   firmware-cli help             - Show help
echo.
echo Examples:
echo   firmware-cli flash
echo   firmware-cli flash "C:\firmware\test.zip"
echo.
echo ========================================

