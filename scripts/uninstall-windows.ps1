# uninstall-windows.ps1 — Remove Wenmei and its Windows integrations.
#
# By default removes:
#   - The Wenmei app directory
#   - Start Menu shortcuts
#   - File association registry entries
#
# Optional flags:
#   -RemoveApp      Also remove the app installation directory
#   -PurgeState     Also remove app data, config, and WebView caches
#   -Yes            Skip confirmation prompts
#
# Your Documents/vault folders and markdown files are NEVER touched.
# Requires Administrator privileges for registry cleanup.
#Requires -Version 5.1
param(
    [switch]$RemoveApp,
    [switch]$PurgeState,
    [switch]$Yes
)

$ErrorActionPreference = "Stop"

# Common install locations
$InstallDirs = @(
    "$env:LOCALAPPDATA\Programs\Wenmei",
    "$env:ProgramFiles\Wenmei"
)
$StartMenuDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Wenmei"
$RegKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Wenmei"

# App data locations
$StatePaths = @(
    "$env:APPDATA\Wenmei",
    "$env:LOCALAPPDATA\Wenmei",
    "$env:LOCALAPPDATA\com.wenmei.desktop"
)

function Confirm-Action($message) {
    if ($Yes) { return $true }
    $reply = Read-Host "$message [y/N]"
    return $reply -eq "y" -or $reply -eq "Y"
}

$actions = @()

# Find actual install directory
$FoundInstallDir = $null
foreach ($dir in $InstallDirs) {
    if (Test-Path $dir) {
        $FoundInstallDir = $dir
        break
    }
}

if ($FoundInstallDir) {
    $actions += "remove app directory: $FoundInstallDir"
}

if (Test-Path $StartMenuDir) {
    $actions += "remove Start Menu shortcuts"
}

if (Test-Path $RegKey) {
    $actions += "remove registry uninstall entry"
}

# File associations (best-effort registry cleanup)
$ProgId = "Wenmei.md"
$assocKeys = @(
    "HKCU:\Software\Classes\.md",
    "HKCU:\Software\Classes\.markdown",
    "HKCU:\Software\Classes\.mdown",
    "HKCU:\Software\Classes\.mkd",
    "HKCU:\Software\Classes\$ProgId"
)
foreach ($key in $assocKeys) {
    if (Test-Path $key) {
        $actions += "remove registry key: $key"
    }
}

if ($PurgeState) {
    foreach ($p in $StatePaths) {
        if (Test-Path $p) {
            $actions += "remove app data: $p"
        }
    }
}

if ($actions.Count -eq 0) {
    Write-Host "Nothing to remove."
    Write-Host ""
    Write-Host "Hints:"
    if (-not $FoundInstallDir) { Write-Host "  - Wenmei is not installed in the usual locations." }
    if (-not $PurgeState) { Write-Host "  - Pass -PurgeState to also remove app data and caches." }
    exit 0
}

Write-Host "Will perform:"
foreach ($a in $actions) { Write-Host "  - $a" }
Write-Host ""
Write-Host "Will NOT touch any Documents, Desktop, or vault folders."
Write-Host ""

if (-not (Confirm-Action "Proceed?")) {
    Write-Host "Aborted."
    exit 0
}

# Remove install directory
if ($FoundInstallDir) {
    Remove-Item -Recurse -Force $FoundInstallDir
    Write-Host "Removed $FoundInstallDir"
}

# Remove Start Menu shortcuts
if (Test-Path $StartMenuDir) {
    Remove-Item -Recurse -Force $StartMenuDir
    Write-Host "Removed Start Menu shortcuts"
}

# Remove registry entries
if (Test-Path $RegKey) {
    Remove-Item -Recurse -Force $RegKey
    Write-Host "Removed registry uninstall entry"
}

foreach ($key in $assocKeys) {
    if (Test-Path $key) {
        Remove-Item -Recurse -Force $key
        Write-Host "Removed registry key: $key"
    }
}

# Refresh icon cache so "Open With" menus update
ie4uinit.exe -show 2>$null || true

# Remove app data
if ($PurgeState) {
    foreach ($p in $StatePaths) {
        if (Test-Path $p) {
            Remove-Item -Recurse -Force $p
            Write-Host "Removed $p"
        }
    }
    Write-Host "Purged app state and WebView caches."
}

Write-Host ""
Write-Host "Done."
