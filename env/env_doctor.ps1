# Script to fix Path environment variable by removing quotes and empty entries
# This will help resolve Python extension loading issues

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   PATH Environment Variable Fix Tool" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Function to clean a PATH string (must be defined before use)
function Clean-Path {
    param([string]$pathString)
    
    if ([string]::IsNullOrWhiteSpace($pathString)) {
        return @()
    }
    
    # Split by semicolon and clean each part
    $parts = $pathString -split ';' | ForEach-Object {
        $part = $_.Trim()
        # Remove quotes from both ends
        $part = $part.Trim('"')
        # Skip empty entries
        if (-not [string]::IsNullOrWhiteSpace($part)) {
            $part
        }
    }
    
    return $parts
}

# Get current PATH variables
$userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
$systemPath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
$processPath = $env:PATH

# Check which PATH has entries
$userPathParts = Clean-Path $userPath
$systemPathParts = Clean-Path $systemPath

Write-Host "Analyzing PATH variables..." -ForegroundColor Yellow
Write-Host ""
Write-Host "User PATH entries: $($userPathParts.Count)" -ForegroundColor Cyan
Write-Host "System PATH entries: $($systemPathParts.Count)" -ForegroundColor Cyan
Write-Host ""

# Ask which PATH to analyze
if ($userPathParts.Count -eq 0 -and $systemPathParts.Count -eq 0) {
    Write-Host "WARNING: Both User and System PATH appear to be empty!" -ForegroundColor Red
    Write-Host "Current process PATH has $($processPath.Count) characters" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Possible causes:" -ForegroundColor Yellow
    Write-Host "  1. PATH variable was recently cleared" -ForegroundColor White
    Write-Host "  2. You have no Administrator rights to access System PATH" -ForegroundColor White
    Write-Host "  3. PATH entries have been corrupted" -ForegroundColor White
    Write-Host ""
    Write-Host "Recommendations:" -ForegroundColor Yellow
    Write-Host "  1. Try running this script as Administrator" -ForegroundColor White
    Write-Host "  2. Check Environment Variables in System Settings" -ForegroundColor White
    Write-Host "  3. Restart your computer" -ForegroundColor White
    Write-Host ""
    Write-Host "Press any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit
}

# Select which PATH to analyze
Write-Host "Select which PATH to analyze:" -ForegroundColor Yellow
Write-Host "  1. User PATH (current user)" -ForegroundColor Cyan
Write-Host "  2. System PATH (all users, requires Admin)" -ForegroundColor Cyan
Write-Host ""
$pathChoice = Read-Host "Select option (1 or 2)"

$targetScope = "User"
$targetPath = $userPath
$targetParts = $userPathParts

if ($pathChoice -eq "2") {
    $targetScope = "Machine"
    $targetPath = $systemPath
    $targetParts = $systemPathParts
}

Write-Host ""
Write-Host "Analyzing $targetScope PATH..." -ForegroundColor Yellow
Write-Host ""

# Function to find paths with quotes
function Find-PathsWithQuotes {
    param([string]$pathString)
    
    $parts = $pathString -split ';' | ForEach-Object {
        $part = $_.Trim()
        if ($part -match '"' -and -not [string]::IsNullOrWhiteSpace($part)) {
            $part
        }
    }
    
    return $parts
}

# Function to find duplicate paths
function Find-DuplicatePaths {
    param([string]$pathString)
    
    $parts = $pathString -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim('"').Trim() }
    $seen = @{ }
    $duplicates = @()
    
    foreach ($part in $parts) {
        $lower = $part.ToLower()
        if ($seen.ContainsKey($lower)) {
            if (-not $duplicates.Contains($part)) {
                $duplicates += $part
            }
        } else {
            $seen[$lower] = $true
        }
    }
    
    return $duplicates
}

# Find paths with quotes
Write-Host "--- Checking for quotes in PATH ---" -ForegroundColor Yellow
$pathsWIthQuotes = Find-PathsWithQuotes $targetPath
if ($pathsWIthQuotes.Count -gt 0) {
    Write-Host "  Found $($pathsWIthQuotes.Count) paths with quotes:" -ForegroundColor Red
    foreach ($path in $pathsWIthQuotes) {
        Write-Host "    - $path" -ForegroundColor Red
    }
} else {
    Write-Host "  No quotes found in PATH" -ForegroundColor Green
}

# Find duplicate paths
Write-Host ""
Write-Host "--- Checking for duplicate paths ---" -ForegroundColor Yellow
$duplicatePaths = Find-DuplicatePaths $targetPath
if ($duplicatePaths.Count -gt 0) {
    Write-Host "  Found $($duplicatePaths.Count) duplicate paths:" -ForegroundColor Red
    foreach ($path in $duplicatePaths) {
        Write-Host "    - $path" -ForegroundColor Red
    }
} else {
    Write-Host "  No duplicates found in PATH" -ForegroundColor Green
}

# Show PATH details
Write-Host ""
Write-Host "--- $targetScope PATH Details ---" -ForegroundColor Yellow
$hasQuotesInUser = $targetParts.Count -ne ($targetPath -split ';').Count

$pathIndex = 0
$pathStatusMap = @{ }

foreach ($part in $targetParts) {
    $pathIndex++
    $exists = Test-Path $part -ErrorAction SilentlyContinue
    
    if ($exists) {
        Write-Host "  [$pathIndex] [OK] $part" -ForegroundColor Green
        $pathStatusMap[$pathIndex] = @{ Path = $part; Exists = $true }
    } else {
        Write-Host "  [$pathIndex] [MISSING] $part" -ForegroundColor Yellow
        $pathStatusMap[$pathIndex] = @{ Path = $part; Exists = $false }
    }
}

# Show stats
$originalCount = ($targetPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
$cleanedCount = $targetParts.Count
$removedCount = $originalCount - $cleanedCount

Write-Host ""
Write-Host "$targetScope PATH: $originalCount -> $cleanedCount (removed $removedCount entries)" -ForegroundColor Cyan

# Interactive path removal option
Write-Host ""
Write-Host "Options:" -ForegroundColor Yellow
Write-Host "  1. Remove specific paths by index" -ForegroundColor Cyan
Write-Host "  2. Remove all paths marked as [MISSING]" -ForegroundColor Cyan
Write-Host "  3. Auto-fix (remove quotes, empty, and duplicates)" -ForegroundColor Cyan
Write-Host "  4. Exit without changes" -ForegroundColor Cyan
Write-Host ""
$option = Read-Host "Select an option (1-4)"

switch ($option) {
    "1" {
        Write-Host ""
        Write-Host "Enter path indices to remove (comma-separated, e.g., 1,3,5):" -ForegroundColor Yellow
        $indicesInput = Read-Host
        $indicesToRemove = $indicesInput -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ }
        
        if ($indicesToRemove.Count -eq 0) {
            Write-Host ""
            Write-Host "No valid indices provided. Operation cancelled." -ForegroundColor Yellow
        } else {
            Write-Host ""
            Write-Host "Paths to be removed:" -ForegroundColor Yellow
            $indicesToRemove = $indicesToRemove | Sort-Object -Descending
            foreach ($idx in $indicesToRemove) {
                if ($pathStatusMap.ContainsKey($idx)) {
                    $pathInfo = $pathStatusMap[$idx]
                    $status = if ($pathInfo.Exists) { "[OK]" } else { "[MISSING]" }
                    Write-Host "  [$idx] $status $($pathInfo.Path)" -ForegroundColor Yellow
                }
            }
            Write-Host ""
            $confirm = Read-Host "Confirm removal? (yes/no)"
            
            if ($confirm -eq 'yes') {
                # Remove paths
                $newParts = @()
                $removeSet = @{}
                foreach ($idx in $indicesToRemove) {
                    $removeSet[$idx] = $true
                }
                
                for ($i = 0; $i -lt $targetParts.Count; $i++) {
                    if (-not $removeSet.ContainsKey($i + 1)) {
                        $newParts += $targetParts[$i]
                    }
                }
                
                $newPath = $newParts -join ';'
                try {
                    [Environment]::SetEnvironmentVariable("PATH", $newPath, $targetScope)
                    Write-Host "  [SUCCESS] Removed $($indicesToRemove.Count) path(s)" -ForegroundColor Green
                    Write-Host ""
                    Write-Host "IMPORTANT: You need to:" -ForegroundColor Yellow
                    Write-Host "  1. Close all VS Code windows" -ForegroundColor White
                    Write-Host "  2. Restart VS Code" -ForegroundColor White
                } catch {
                    Write-Host "  [ERROR] Failed to update PATH: $_" -ForegroundColor Red
                }
            } else {
                Write-Host "Operation cancelled." -ForegroundColor Yellow
            }
        }
    }
    
    "2" {
        Write-Host ""
        Write-Host "Removing all paths marked as [MISSING]..." -ForegroundColor Yellow
        $missingPaths = $pathStatusMap.Values | Where-Object { -not $_.Exists }
        
        if ($missingPaths.Count -eq 0) {
            Write-Host "No missing paths found. Nothing to remove." -ForegroundColor Green
        } else {
            Write-Host "Paths to be removed:" -ForegroundColor Yellow
            foreach ($pathInfo in $missingPaths) {
                Write-Host "  [MISSING] $($pathInfo.Path)" -ForegroundColor Yellow
            }
            Write-Host ""
            $confirm = Read-Host "Confirm removal? (yes/no)"
            
            if ($confirm -eq 'yes') {
                $newParts = $targetParts | Where-Object { Test-Path $_ -ErrorAction SilentlyContinue }
                $newPath = $newParts -join ';'
                try {
                    [Environment]::SetEnvironmentVariable("PATH", $newPath, $targetScope)
                    Write-Host "  [SUCCESS] Removed $($missingPaths.Count) missing path(s)" -ForegroundColor Green
                    Write-Host ""
                    Write-Host "IMPORTANT: You need to:" -ForegroundColor Yellow
                    Write-Host "  1. Close all VS Code windows" -ForegroundColor White
                    Write-Host "  2. Restart VS Code" -ForegroundColor White
                } catch {
                    Write-Host "  [ERROR] Failed to update PATH: $_" -ForegroundColor Red
                }
            } else {
                Write-Host "Operation cancelled." -ForegroundColor Yellow
            }
        }
    }
    
    "3" {
        Write-Host ""
        Write-Host "Do you want to fix the $targetScope PATH?" -ForegroundColor Yellow
        Write-Host "This will:" -ForegroundColor Yellow
        Write-Host "  - Remove all quote characters from paths" -ForegroundColor White
        Write-Host "  - Remove empty entries" -ForegroundColor White
        Write-Host "  - Remove duplicate entries" -ForegroundColor White
        Write-Host ""
        $confirm = Read-Host "Type 'yes' to proceed, or press Enter to cancel"
        
        if ($confirm -eq 'yes') {
            Write-Host ""
            Write-Host "Fixing $targetScope PATH..." -ForegroundColor Yellow
            
            # Remove duplicates while preserving order
            $uniqueParts = @()
            $seen = @{ }
            foreach ($part in $targetParts) {
                $lower = $part.ToLower()
                if (-not $seen.ContainsKey($lower)) {
                    $seen[$lower] = $true
                    $uniqueParts += $part
                }
            }
            
            # Rebuild PATH
            $newPath = $uniqueParts -join ';'
            
            # Set the new PATH
            try {
                [Environment]::SetEnvironmentVariable("PATH", $newPath, $targetScope)
                Write-Host "  [SUCCESS] $targetScope PATH has been fixed!" -ForegroundColor Green
                
                # Show what changed
                $removedDuplicates = $targetParts.Count - $uniqueParts.Count
                if ($removedDuplicates -gt 0) {
                    Write-Host "  [INFO] Removed $removedDuplicates duplicate entries" -ForegroundColor Cyan
                }
                
                Write-Host ""
                Write-Host "IMPORTANT: You need to:" -ForegroundColor Yellow
                Write-Host "  1. Close all VS Code windows" -ForegroundColor White
                Write-Host "  2. Restart VS Code" -ForegroundColor White
                Write-Host "  3. The Python extension should now load correctly" -ForegroundColor White
            } catch {
                Write-Host "  [ERROR] Failed to update PATH: $_" -ForegroundColor Red
                Write-Host "  You may need administrator privileges" -ForegroundColor Red
            }
        } else {
            Write-Host ""
            Write-Host "Operation cancelled." -ForegroundColor Yellow
        }
    }
    
    "4" {
        Write-Host ""
        Write-Host "Exiting without changes." -ForegroundColor Yellow
    }
    
    default {
        Write-Host ""
        Write-Host "Invalid option. Exiting." -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
