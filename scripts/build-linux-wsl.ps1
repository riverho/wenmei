# Build Wenmei Linux artifacts from Windows via WSL
# Usage: .\scripts\build-linux-wsl.ps1
# Prerequisites: WSL with Ubuntu, Rust + cargo-tauri installed inside WSL

$ErrorActionPreference = "Stop"

# Check WSL
wsl -d Ubuntu -u root -- bash -c "echo 'WSL OK'" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "WSL Ubuntu not available. Install WSL first: wsl --install -d Ubuntu"
}

# Check cargo-tauri in WSL
$hasCargoTauri = wsl -d Ubuntu -u root -- bash -c "source ~/.cargo/env && cargo tauri --version 2>/dev/null" | Out-String
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($hasCargoTauri)) {
    Write-Host "Installing cargo-tauri in WSL..."
    wsl -d Ubuntu -u root -- bash -c "source ~/.cargo/env && cargo install tauri-cli --locked"
}

# Build frontend on Windows (platform-independent)
Write-Host "Building frontend..."
npm run build

# Write temp build script inside WSL to avoid quote-escaping hell
$wslProject = "/mnt/c/Users/$env:USERNAME/Documents/Wenmei"

wsl -d Ubuntu -u root -- bash -c @"
set -e
source ~/.cargo/env
cd $wslProject
cargo tauri build --config '{\"build\":{\"beforeBuildCommand\":\"\"}}'
"@

if ($LASTEXITCODE -ne 0) {
    Write-Error "WSL build failed"
}

Write-Host "`nBuild complete. Artifacts:"
Write-Host "  DEB : src-tauri/target/release/bundle/deb/"
Write-Host "  RPM : src-tauri/target/release/bundle/rpm/"
Write-Host "  AppImage: src-tauri/target/release/bundle/appimage/"
