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
#                   ~/Library/WebKit/com.wenmei.desktop
#                   plus sandboxed WebKit/container variants if present
#                   This clears the desktop app's localStorage, including
#                   Zustand key `wenmei-store`.
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
USER_APP="$HOME/Applications/Wenmei.app"
STATE_PATHS=(
  "$HOME/Library/Application Support/Wenmei"
  "$HOME/Library/Application Support/com.wenmei.desktop"
  "$HOME/Library/Caches/com.wenmei.desktop"
  "$HOME/Library/Preferences/com.wenmei.desktop.plist"
  "$HOME/Library/WebKit/com.wenmei.desktop"
  "$HOME/Library/HTTPStorages/com.wenmei.desktop"
  "$HOME/Library/Cookies/com.wenmei.desktop.binarycookies"
  "$HOME/Library/Saved Application State/com.wenmei.desktop.savedState"
  "$HOME/Library/Containers/com.wenmei.desktop"
)

[ -e "$CLI" ] && actions+=("remove $CLI (requires sudo)")
[ -e "$SERVICE" ] && actions+=("remove $SERVICE")
if [ "$REMOVE_APP" = "1" ]; then
  [ -e "$APP" ] && actions+=("remove $APP")
  [ -e "$USER_APP" ] && actions+=("remove $USER_APP")
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
  [ "$REMOVE_APP" = "0" ] && { [ -e "$APP" ] || [ -e "$USER_APP" ]; } && \
    echo "  - App exists in Applications; pass --remove-app to delete it."
  [ "$PURGE_STATE" = "0" ] && \
    echo "  - Pass --purge-state to also remove app config, caches, and desktop WebView localStorage/Zustand state."
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
remove_app() {
  local target="$1"
  if [ -e "$target" ]; then
    if [ -w "$(dirname "$target")" ]; then
      rm -rf "$target" && echo "Removed $target"
    else
      sudo rm -rf "$target" && echo "Removed $target"
    fi
  fi
}

if [ "$REMOVE_APP" = "1" ]; then
  remove_app "$APP"
  remove_app "$USER_APP"
fi

# Purge app-managed state
if [ "$PURGE_STATE" = "1" ]; then
  for p in "${STATE_PATHS[@]}"; do
    if [ -e "$p" ]; then
      rm -rf "$p" && echo "Removed $p"
    fi
  done
  echo "Purged desktop WebView storage; Zustand localStorage key 'wenmei-store' is cleared for the Tauri app."
fi

echo
echo "Done."
if [ "$PURGE_STATE" = "1" ]; then
  echo
  echo "Browser dev note: if you ran plain npm run dev in Chrome/Safari, clear that browser origin separately:"
  echo "  localStorage.removeItem('wenmei-store'); localStorage.removeItem('wenmei-mock-app-state'); location.reload();"
fi
