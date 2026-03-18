# Firmware CLI Test Script
# Run this script to verify all firmware-cli.exe commands

param(
    [string]$ExePath = ".\firmware-cli.exe",
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"
$TestResults = @()

# Color functions
function Write-Success($msg) {
    Write-Host "PASS: $msg" -ForegroundColor Green
}

function Write-Failure($msg) {
    Write-Host "FAIL: $msg" -ForegroundColor Red
}

function Write-Info($msg) {
    Write-Host "INFO: $msg" -ForegroundColor Cyan
}

function Write-TestHeader($msg) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host $msg -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host ""
}

# Test result recorder
function Record-Test($name, $passed, $output, $exitCode) {
    $result = [PSCustomObject]@{
        Test = $name
        Passed = $passed
        ExitCode = $exitCode
        Output = $output
    }
    $script:TestResults += $result
    return $result
}

# Run command and capture output
function Invoke-TestCommand($name, $cmdArgs, $shouldFail = $false) {
    Write-Info "Testing: $name $cmdArgs"
    
    try {
        # Split cmdArgs into array if it's a string
        if ($cmdArgs -is [string]) {
            $argArray = $cmdArgs -split ' '
        } else {
            $argArray = $cmdArgs
        }
        
        # Use Start-Process with timeout for commands that might hang
        $processInfo = New-Object System.Diagnostics.ProcessStartInfo
        $processInfo.FileName = $ExePath
        $processInfo.Arguments = $argArray -join ' '
        $processInfo.RedirectStandardOutput = $true
        $processInfo.RedirectStandardError = $true
        $processInfo.UseShellExecute = $false
        
        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $processInfo
        $process.Start() | Out-Null
        
        # Wait up to 5 seconds for the process to complete
        if (!$process.WaitForExit(5000)) {
            $process.Kill()
            $output = "Command timed out (expected for monitor without port)"
            $exitCode = 1
        } else {
            $output = $process.StandardOutput.ReadToEnd() + $process.StandardError.ReadToEnd()
            $exitCode = $process.ExitCode
        }
        
        if ($Verbose) {
            Write-Host "Exit Code: $exitCode"
            Write-Host "Output:"
            $output | ForEach-Object { Write-Host "  $_" }
        }
        
        $passed = ($exitCode -eq 0)
        if ($passed) {
            Write-Success $name
        } else {
            Write-Failure "$name (Exit Code: $exitCode)"
        }
        
        return Record-Test -name $name -passed $passed -output $output -exitCode $exitCode
    } catch {
        $errorMsg = "EXCEPTION in ${name}: $_"
        Write-Failure $errorMsg
        return Record-Test -name $name -passed $false -output $errorMsg -exitCode -1
    }
}

# Start testing
Write-Host "========================================"
Write-Host "Firmware CLI Test Suite"
Write-Host "Testing: $ExePath"
Write-Host "========================================"
Write-Host ""

# Check if exe exists
if (!(Test-Path $ExePath)) {
    Write-Failure "ERROR: firmware-cli.exe not found at $ExePath"
    Write-Host ""
    Write-Host "Please build the exe first:" -ForegroundColor Yellow
    Write-Host "  npm run build:exe" -ForegroundColor Yellow
    exit 1
}

Write-Success "Found firmware-cli.exe"
Write-Host ""

# Test 1: Help command
Write-TestHeader "Test 1: Help Command"
Invoke-TestCommand "help" "help"
Invoke-TestCommand "help-long" "--help"
Invoke-TestCommand "help-short" "-h"

# Test 2: List command
Write-TestHeader "Test 2: List Firmware"
Invoke-TestCommand "list" "list"

# Test 3: Config commands
Write-TestHeader "Test 3: Configuration"
Invoke-TestCommand "config-show" "config"
# Test setting a config (will be validated)
$configTest = Invoke-TestCommand "config-set" "config set testKey testValue"
if ($configTest.Passed) {
    Write-Info "Config set command works"
}

# Test 4: Device listing commands
Write-TestHeader "Test 4: Device Enumeration"
Invoke-TestCommand "devices" "devices"
Invoke-TestCommand "serial" "serial"

# Test 5: Monitor command (dry run - will fail without port)
Write-TestHeader "Test 5: Monitor Command (Expected to fail without port)"
$monitorTest = Invoke-TestCommand "monitor-no-args" "monitor"
if (!$monitorTest.Passed) {
    Write-Info "Monitor command correctly requires port argument"
}

# Test 6: Invalid command handling
Write-TestHeader "Test 6: Error Handling"
$invalidTest = Invoke-TestCommand "invalid-command" "invalid-command"
if (!$invalidTest.Passed) {
    Write-Success "Invalid command properly rejected"
}

# Test 7: Flash command (dry run - will fail without firmware)
Write-TestHeader "Test 7: Flash Command (Expected to fail without firmware)"
$flashTest = Invoke-TestCommand "flash" "flash"
if (!$flashTest.Passed) {
    Write-Info "Flash command correctly requires firmware"
}

# Test 8: Build command (dry run - will fail without build scripts)
Write-TestHeader "Test 8: Build Command (Expected to fail without build scripts)"
$buildTest = Invoke-TestCommand "build" "build"
if (!$buildTest.Passed) {
    Write-Info "Build command correctly requires build scripts"
}

# Print summary
Write-TestHeader "Test Summary"
$passed = ($TestResults | Where-Object { $_.Passed -eq $true }).Count
$failed = ($TestResults | Where-Object { $_.Passed -eq $false }).Count
$total = $TestResults.Count

Write-Host "Total Tests: $total" -ForegroundColor White
Write-Host "Passed: $passed" -ForegroundColor Green
Write-Host "Failed: $failed" -ForegroundColor Red
if ($total -gt 0) {
    $successRate = [math]::Round(($passed / $total) * 100, 2)
    Write-Host "Success Rate: $successRate%" -ForegroundColor White
} else {
    Write-Host "Success Rate: N/A" -ForegroundColor Yellow
}

# Print failed tests if any
if ($failed -gt 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "Failed Tests:" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    foreach ($test in $TestResults | Where-Object { $_.Passed -eq $false }) {
        Write-Host ""
        Write-Host "Test: $($test.Test)" -ForegroundColor Red
        Write-Host "Exit Code: $($test.ExitCode)" -ForegroundColor Red
        Write-Host "Output:" -ForegroundColor Red
        $test.Output -split "`n" | ForEach-Object { Write-Host "  $_" }
    }
}

# Save results to file
$testDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$resultsFile = Join-Path $testDir "test-results-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
$TestResults | ConvertTo-Json -Depth 3 | Out-File -FilePath $resultsFile -Encoding UTF8
Write-Success "Results saved to: $resultsFile"

# Exit with appropriate code
if ($failed -gt 0) {
    exit 1
} else {
    exit 0
}