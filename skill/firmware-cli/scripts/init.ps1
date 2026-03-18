# Firmware CLI Tool - Environment Setup (PowerShell Version)
# This script adds firmware-cli to PATH for PowerShell sessions

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition
$FIRMWARE_CLI = Join-Path $SCRIPT_DIR "firmware-cli.exe"

Write-Host "========================================"
Write-Host "   Firmware CLI Tool - Environment Setup"
Write-Host "========================================"
Write-Host ""

# Check if firmware-cli.exe exists
if (-not (Test-Path $FIRMWARE_CLI)) {
    Write-Host "[ERROR] firmware-cli.exe not found" -ForegroundColor Red
    Write-Host "Path: $FIRMWARE_CLI"
    exit 1
}

Write-Host "[CHECK] firmware-cli.exe exists: $FIRMWARE_CLI"
Write-Host ""

# Clean the SCRIPT_DIR to ensure no quotes or extra spaces
$SCRIPT_DIR = $SCRIPT_DIR.Trim().Trim('"')

# Check if already in current session PATH
if ($env:PATH -split ';' | ForEach-Object { $_.Trim().Trim('"') } | Where-Object { $_ -eq $SCRIPT_DIR }) {
    Write-Host "[INFO] firmware-cli is already in current session PATH"
} else {
    Write-Host "[INFO] firmware-cli is not in current session PATH"
}

# Get current user PATH from registry and clean it
$currPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($currPath) {
    # Clean PATH: remove quotes from each path segment
    $cleanedPathParts = @($currPath -split ';' | ForEach-Object { $_.Trim().Trim('"') } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $currPath = $cleanedPathParts -join ';'
}

# Check if already in user PATH (using cleaned paths)
if ($currPath -split ';' | ForEach-Object { $_.Trim().Trim('"') } | Where-Object { $_ -eq $SCRIPT_DIR }) {
    Write-Host ""
    Write-Host "[SUCCESS] firmware-cli has been added to user PATH environment variable" -ForegroundColor Green
    Write-Host "Path: $SCRIPT_DIR"
    Write-Host ""
    Write-Host "You can now use firmware-cli command in any PowerShell window"
} else {
    # Add to user PATH (ensure no quotes)
    Write-Host ""
    Write-Host "[ACTION] Adding firmware-cli to user PATH..."
    
    try {
        $newPath = if ($currPath) { "$currPath;$SCRIPT_DIR" } else { $SCRIPT_DIR }
        [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
        
        Write-Host ""
        Write-Host "[SUCCESS] Added $SCRIPT_DIR to user PATH" -ForegroundColor Green
        Write-Host ""
        Write-Host "Note: New environment variables will take effect in new PowerShell windows"
        Write-Host "Current window has temporarily added PATH, ready to use"
        
        # Refresh current session PATH
        $env:PATH = "$SCRIPT_DIR;$env:PATH"
    } catch {
        Write-Host ""
        Write-Host "[WARNING] Failed to modify PATH, may require administrator privileges" -ForegroundColor Yellow
        Write-Host "Please try manually adding the following path to system PATH:"
        Write-Host $SCRIPT_DIR
    }
}

# Show help
Write-Host ""
Write-Host "========================================"
Write-Host "   firmware-cli Usage Help"
Write-Host "========================================"
Write-Host ""
Write-Host "Available commands:"
Write-Host "  firmware-cli flash            - Flash firmware (auto-detect)"
Write-Host "  firmware-cli flash <path>     - Flash specified firmware"
Write-Host "  firmware-cli list             - List available firmwares"
Write-Host "  firmware-cli devices          - List USB devices"
Write-Host "  firmware-cli build            - Build firmware"
Write-Host "  firmware-cli build-and-flash  - Build and flash"
Write-Host "  firmware-cli config           - View configuration"
Write-Host "  firmware-cli help             - Show help"
Write-Host ""
Write-Host "Examples:"
Write-Host '  firmware-cli flash'
Write-Host '  firmware-cli flash "C:\firmware\test.zip"'
Write-Host ""
Write-Host "========================================"
