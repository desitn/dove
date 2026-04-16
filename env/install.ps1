# Dove Installation Script
# Usage: Run this script in PowerShell: .\env\install.ps1
# This script adds dove.exe to the user PATH environment variable

param(
    [string]$InstallPath = "",
    [bool]$AddToPath = $true
)

# Determine installation directory (go up from env/ to root)
if ($InstallPath -eq "") {
    $scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
    # If script is in env/ subdirectory, go up one level
    if ((Split-Path -Leaf $scriptPath) -eq "env") {
        $InstallPath = Split-Path -Parent $scriptPath
    } else {
        $InstallPath = $scriptPath
    }
}

Write-Host "Dove Firmware CLI Tool Installation" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Check if dove.exe exists
$doveExe = Join-Path $InstallPath "dove.exe"
if (-not (Test-Path $doveExe)) {
    Write-Host "[FAILED] dove.exe not found" -ForegroundColor Red
    Write-Host "Path checked: $InstallPath" -ForegroundColor Red
    Write-Host ""
    Write-Host "Press any key to exit..." -ForegroundColor Yellow
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

# Installation result tracking
$installSuccess = $true
$pathAdded = $false

# Add to PATH
if ($AddToPath) {
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")

    # Check if already in PATH
    if ($currentPath -like "*$InstallPath*") {
        $pathAdded = $false
    } else {
        # Add to user PATH
        $newPath = "$InstallPath;$currentPath"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        $pathAdded = $true
    }
} else {
    $pathAdded = $false
}

# Display installation result
Write-Host "Installation Result" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Status:       " -NoNewline
if ($installSuccess) {
    Write-Host "SUCCESS" -ForegroundColor Green
} else {
    Write-Host "FAILED" -ForegroundColor Red
}
Write-Host ""
Write-Host "  Install Path: $InstallPath"
Write-Host "  Executable:   $doveExe"
Write-Host ""
Write-Host "  PATH Status:  " -NoNewline
if ($pathAdded) {
    Write-Host "ADDED (new)" -ForegroundColor Green
} else {
    Write-Host "EXISTS (already in PATH)" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

if ($pathAdded) {
    Write-Host "Note: Restart your terminal for PATH changes to take effect" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "Quick Start:" -ForegroundColor Cyan
Write-Host "  dove help           Show help"
Write-Host "  dove flash          Flash firmware"
Write-Host "  dove build          Build firmware"
Write-Host "  dove port list      List serial ports"
Write-Host ""

Write-Host "Press any key to exit..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")