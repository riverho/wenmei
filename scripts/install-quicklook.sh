#!/usr/bin/env bash
# install-quicklook.sh — Install Wenmei Quick Look plugin.
#
# This copies the .qlgenerator bundle to ~/Library/QuickLook/ where macOS
# Quick Look daemon will find it. Requires running `qlmanage -r` after install
# to register the plugin.
#
# Note: The actual WenmeiPreview.qlgenerator bundle does not yet exist.
# See docs/first_run_onboarding.md §3 for the full Quick Look implementation plan.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_SOURCE="$SCRIPT_DIR/../src-tauri/quicklook/WenmeiPreview.qlgenerator"
DEST="$HOME/Library/QuickLook/WenmeiPreview.qlgenerator"

echo "=== Installing Wenmei Quick Look Plugin ==="

if [ ! -d "$PLUGIN_SOURCE" ]; then
  echo "Error: Quick Look plugin not found at:"
  echo "  $PLUGIN_SOURCE"
  echo
  echo "The Quick Look plugin has not been built yet."
  echo "See docs/first_run_onboarding.md §3 for implementation details."
  exit 1
fi

mkdir -p "$HOME/Library/QuickLook"
cp -r "$PLUGIN_SOURCE" "$DEST"
chmod -R a+r "$DEST"

echo "Installed: $DEST"
echo
echo "Registering with macOS..."
qlmanage -r 2>/dev/null || true
echo "Done."
echo
echo "Test it: open Finder, select a .md file, press Space."