#!/usr/bin/env bash
# verify.sh — Check Wenmei system integration status.
set -euo pipefail

echo "=== Wenmei Install Status ==="
echo

installed=0 missing=0

# CLI shim
if command -v wenmei >/dev/null 2>&1; then
  echo "✓ CLI shim: $(command -v wenmei)"
  (( installed++ ))
else
  echo "✗ CLI shim: not found"
  echo "    Run: bash scripts/install-cli.sh"
  (( missing++ ))
fi

# Finder service
SVC="$HOME/Library/Services/Open in New Wenmei Window.workflow"
if [ -d "$SVC" ]; then
  echo "✓ Finder service: installed"
  (( installed++ ))
else
  echo "✗ Finder service: not found"
  echo "    Run: bash scripts/install-finder-service.sh"
  (( missing++ ))
fi

# Quick Look plugin
QLP="$HOME/Library/QuickLook/WenmeiPreview.qlgenerator"
if [ -d "$QLP" ]; then
  echo "✓ Quick Look: WenmeiPreview.qlgenerator"
  (( installed++ ))
else
  # Also check inside app bundle
  APP_QLP="/Applications/Wenmei.app/Contents/Library/QuickLook/WenmeiPreview.qlgenerator"
  if [ -d "$APP_QLP" ]; then
    echo "✓ Quick Look: bundled in app"
    (( installed++ ))
  else
    echo "○ Quick Look: not installed (run scripts/install.sh --quicklook)"
    (( missing++ ))
  fi
fi

# App bundle
if [ -d "/Applications/Wenmei.app" ]; then
  echo "✓ App: /Applications/Wenmei.app"
elif [ -d "$HOME/Applications/Wenmei.app" ]; then
  echo "✓ App: ~/Applications/Wenmei.app"
else
  echo "✗ App bundle: not found in /Applications or ~/Applications"
  (( missing++ ))
fi

echo
echo "Summary: $installed installed, $missing not found"
[ "$missing" -eq 0 ] && echo "All integrations ready."