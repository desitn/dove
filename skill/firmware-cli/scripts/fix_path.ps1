# Script to fix Path environment variable by removing quotes and empty entries
# This will help resolve Python extension loading issues

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   PATH Environment Variable Fix Tool" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get current user PATH
$userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
$systemPath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
$processPath = $env:PATH

Write-Host "Analyzing PATH variables..." -ForegroundColor Yellow
Write-Host ""

# Function to clean a PATH string
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
    $seen = @{}
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
$pathsWIthQuotes = Find-PathsWithQuotes $userPath
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
$duplicatePaths = Find-DuplicatePaths $userPath
if ($duplicatePaths.Count -gt 0) {
    Write-Host "  Found $($duplicatePaths.Count) duplicate paths:" -ForegroundColor Red
    foreach ($path in $duplicatePaths) {
        Write-Host "    - $path" -ForegroundColor Red
    }
} else {
    Write-Host "  No duplicates found in PATH" -ForegroundColor Green
}

# Clean user PATH
Write-Host ""
Write-Host "--- User PATH Details ---" -ForegroundColor Yellow
$userPathParts = Clean-Path $userPath
$hasQuotesInUser = $userPathParts.Count -ne ($userPath -split ';').Count

foreach ($part in $userPathParts) {
    if (Test-Path $part -ErrorAction SilentlyContinue) {
        Write-Host "  [OK] $part" -ForegroundColor Green
    } else {
        Write-Host "  [MISSING] $part" -ForegroundColor Yellow
    }
}

# Show stats
$userOriginalCount = ($userPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
$userCleanedCount = $userPathParts.Count
$removedCount = $userOriginalCount - $userCleanedCount

Write-Host ""
Write-Host "User PATH: $userOriginalCount -> $userCleanedCount (removed $removedCount entries)" -ForegroundColor Cyan

# Show summary
$totalIssues = 0
if ($pathsWIthQuotes.Count -gt 0) { $totalIssues += $pathsWIthQuotes.Count }
if ($duplicatePaths.Count -gt 0) { $totalIssues += $duplicatePaths.Count }

if ($totalIssues -gt 0) {
    Write-Host ""
    Write-Host "  [ISSUES FOUND] Total issues: $totalIssues" -ForegroundColor Red
    Write-Host "    - Paths with quotes: $($pathsWIthQuotes.Count)" -ForegroundColor Red
    Write-Host "    - Duplicate paths: $($duplicatePaths.Count)" -ForegroundColor Red
}

Write-Host ""
Write-Host "Do you want to fix the User PATH?" -ForegroundColor Yellow
Write-Host "This will:" -ForegroundColor Yellow
Write-Host "  - Remove all quote characters from paths" -ForegroundColor White
Write-Host "  - Remove empty entries" -ForegroundColor White
Write-Host "  - Remove duplicate entries" -ForegroundColor White
Write-Host ""
$confirm = Read-Host "Type 'yes' to proceed, or press Enter to cancel"

if ($confirm -eq 'yes') {
    Write-Host ""
    Write-Host "Fixing User PATH..." -ForegroundColor Yellow
    
    # Remove duplicates while preserving order
    $uniqueParts = @()
    $seen = @{}
    foreach ($part in $userPathParts) {
        $lower = $part.ToLower()
        if (-not $seen.ContainsKey($lower)) {
            $seen[$lower] = $true
            $uniqueParts += $part
        }
    }
    
    # Rebuild PATH
    $newUserPath = $uniqueParts -join ';'
    
    # Set the new PATH
    try {
        [Environment]::SetEnvironmentVariable("PATH", $newUserPath, "User")
        Write-Host "  [SUCCESS] User PATH has been fixed!" -ForegroundColor Green
        
        # Show what changed
        $removedDuplicates = $userPathParts.Count - $uniqueParts.Count
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

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")