#!/usr/bin/env bash
# uninstall.sh — revert the Wenmei shell integration install.
#
# By default removes:
#   - /usr/local/bin/wenmei
#   - ~/Library/Services/Open in New Wenmei Window.workflow
#
# Optional flags (off by default — these are larger blast-radius):
#   --remove-app    Also delete /Applications/Wenmei.app
#   --purge-state   Also delete app config under
#                   ~/Library/Application Support/Wenmei
#                   ~/Library/Application Support/com.wenmei.desktop
#                   ~/Library/Caches/com.wenmei.desktop
#                   ~/Library/Preferences/com.wenmei.desktop.plist
#   --yes / -y      Skip confirmation prompts
#
# This script never touches user vault contents or `.wenmei/` folders inside
# user vaults. Those are your data; remove them manually if you wish.
set -euo pipefail

REMOVE_APP=0
PURGE_STATE=0
ASSUME_YES=0

for arg in "$@"; do
  case "$arg" in
    --remove-app) REMOVE_APP=1 ;;
    --purge-state) PURGE_STATE=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

confirm() {
  [ "$ASSUME_YES" = "1" ] && return 0
  printf '%s [y/N] ' "$1"
  read -r reply
  [ "$reply" = "y" ] || [ "$reply" = "Y" ]
}

# Build the list of targets so we can show one summary upfront
declare -a actions=()

CLI="/usr/local/bin/wenmei"
SERVICE="$HOME/Library/Services/Open in New Wenmei Window.workflow"
APP="/Applications/Wenmei.app"
STATE_PATHS=(
  "$HOME/Library/Application Support/Wenmei"
  "$HOME/Library/Application Support/com.wenmei.desktop"
  "$HOME/Library/Caches/com.wenmei.desktop"
  "$HOME/Library/Preferences/com.wenmei.desktop.plist"
  "$HOME/Library/WebKit/com.wenmei.desktop"
  "$HOME/Library/Saved Application State/com.wenmei.desktop.savedState"
)

[ -e "$CLI" ] && actions+=("remove $CLI (requires sudo)")
[ -e "$SERVICE" ] && actions+=("remove $SERVICE")
if [ "$REMOVE_APP" = "1" ] && [ -e "$APP" ]; then
  actions+=("remove $APP")
fi
if [ "$PURGE_STATE" = "1" ]; then
  for p in "${STATE_PATHS[@]}"; do
    [ -e "$p" ] && actions+=("remove $p")
  done
fi

if [ "${#actions[@]}" -eq 0 ]; then
  echo "Nothing to remove."
  echo
  echo "Hints:"
  [ ! -e "$CLI" ] && echo "  - $CLI is already absent."
  [ ! -e "$SERVICE" ] && echo "  - Finder service already absent."
  [ "$REMOVE_APP" = "0" ] && [ -e "$APP" ] && \
    echo "  - $APP exists; pass --remove-app to delete it."
  [ "$PURGE_STATE" = "0" ] && \
    echo "  - Pass --purge-state to also remove app config + caches."
  exit 0
fi

echo "Will perform:"
for a in "${actions[@]}"; do echo "  - $a"; done
echo
echo "Will NOT touch any vault folders or .wenmei/ subfolders inside them."
echo

if ! confirm "Proceed?"; then
  echo "Aborted."
  exit 0
fi

# Remove CLI shim (sudo if needed)
if [ -e "$CLI" ]; then
  if [ -w "$(dirname "$CLI")" ]; then
    rm -f "$CLI" && echo "Removed $CLI"
  else
    sudo rm -f "$CLI" && echo "Removed $CLI"
  fi
fi

# Remove Finder service
if [ -e "$SERVICE" ]; then
  rm -rf "$SERVICE" && echo "Removed Finder service"
  # Refresh Services menu
  /System/Library/CoreServices/pbs -flush 2>/dev/null || true
  killall -HUP Finder 2>/dev/null || true
fi

# Remove app
if [ "$REMOVE_APP" = "1" ] && [ -e "$APP" ]; then
  if [ -w "$(dirname "$APP")" ]; then
    rm -rf "$APP" && echo "Removed $APP"
  else
    sudo rm -rf "$APP" && echo "Removed $APP"
  fi
fi

# Purge app-managed state
if [ "$PURGE_STATE" = "1" ]; then
  for p in "${STATE_PATHS[@]}"; do
    if [ -e "$p" ]; then
      rm -rf "$p" && echo "Removed $p"
    fi
  done
fi

echo
echo "Done."
