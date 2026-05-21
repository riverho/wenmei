#!/usr/bin/env bash
# Uninstall Wenmei.command — DMG launcher for the uninstall flow.
#
# Double-clicked from the mounted Wenmei DMG, this opens Terminal and
# runs the sibling uninstall-macos.sh with the flags needed to fully
# clean an existing install before the user drags in the new version:
#   --remove-app    delete /Applications/Wenmei.app + LaunchServices entry
#   --purge-state   delete app config, caches, WebKit storage (Zustand),
#                   sandbox-meta/, and reset TCC privacy records
#
# The script still prompts before doing anything — nothing is removed
# until the user confirms.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$DIR/uninstall-macos.sh"

if [ ! -f "$SCRIPT" ]; then
  echo "Could not find uninstall-macos.sh next to this command." >&2
  echo "Expected at: $SCRIPT" >&2
  echo
  echo "Press return to close this window."
  read -r
  exit 1
fi

clear
cat <<'BANNER'
Wenmei Uninstaller
==================

This will remove the Wenmei app, its settings, and shell integrations.
Your vault folders and markdown files will NOT be touched.

BANNER

bash "$SCRIPT" --remove-app --purge-state

echo
echo "You can now close this window and drag the new Wenmei.app into Applications."
