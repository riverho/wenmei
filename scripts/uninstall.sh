#!/usr/bin/env bash
# uninstall.sh — revert the Wenmei shell integration install.
#
# By default removes:
#   - /usr/local/bin/wenmei
#   - ~/Library/Services/Open in New Wenmei Window.workflow
#
# Optional flags (off by default — these are larger blast-radius):
#   --remove-app    Also delete /Applications/Wenmei.app and unregister it
#                   from macOS LaunchServices ("Open With" menu, file-type
#                   bindings) via `lsregister -u`.
#   --purge-state   Also delete app config under
#                   ~/Library/Application Support/Wenmei
#                   ~/Library/Application Support/com.wenmei.desktop
#                   ~/Library/Caches/com.wenmei.desktop
#                   ~/Library/Preferences/com.wenmei.desktop.plist
#                   ~/Library/WebKit/com.wenmei.desktop
#                   plus sandboxed WebKit/container variants if present
#                   This clears the desktop app's localStorage, including
#                   Zustand key `wenmei-store`. Also clears global-mode Pi
#                   Panel session history under sandbox-meta/<id>/pi-sessions/
#                   <id>/panel/ (it lives inside Application Support/Wenmei).
#                   Also resets TCC privacy records (`tccutil reset All
#                   com.wenmei.desktop`) so any sandbox-folder authorizations
#                   the user previously granted via macOS file dialogs are
#                   forgotten.
#   --purge-pi-history
#                   Also delete per-vault Pi Panel session history at
#                   <vault>/.wenmei/pi-sessions/<sandbox_id>/panel/. Vault
#                   paths are read from state.json BEFORE --purge-state
#                   removes it. Off by default because it touches data
#                   inside user vaults — pass it explicitly to opt in.
#   --yes / -y      Skip confirmation prompts
#
# Without --purge-pi-history this script never touches user vault contents or
# `.wenmei/` folders inside vaults. Those are your data; remove them manually
# if you wish.
set -euo pipefail

REMOVE_APP=0
PURGE_STATE=0
PURGE_PI_HISTORY=0
ASSUME_YES=0

for arg in "$@"; do
  case "$arg" in
    --remove-app) REMOVE_APP=1 ;;
    --purge-state) PURGE_STATE=1 ;;
    --purge-pi-history) PURGE_PI_HISTORY=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help)
      sed -n '2,36p' "$0"
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
BUNDLE_ID="com.wenmei.desktop"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
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
STATE_JSON="$HOME/Library/Application Support/Wenmei/state.json"

# Resolve per-vault Pi Panel history dirs. We read state.json (the same file
# the Rust app writes via state::save_state) for vault paths, then enumerate
# every <vault>/.wenmei/pi-sessions/<sandbox>/panel/ that exists. Done before
# any deletion so --purge-state and --purge-pi-history can be combined.
declare -a VAULT_PI_PANEL_DIRS=()
if [ "$PURGE_PI_HISTORY" = "1" ] && [ -f "$STATE_JSON" ]; then
  while IFS= read -r vault_path; do
    [ -z "$vault_path" ] && continue
    [ -d "$vault_path/.wenmei/pi-sessions" ] || continue
    while IFS= read -r -d '' panel_dir; do
      VAULT_PI_PANEL_DIRS+=("$panel_dir")
    done < <(find "$vault_path/.wenmei/pi-sessions" -mindepth 2 -maxdepth 2 -type d -name panel -print0 2>/dev/null)
  done < <(python3 - "$STATE_JSON" <<'PY' 2>/dev/null
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
    for v in data.get("vaults", []):
        p = v.get("path")
        if p:
            print(p)
except Exception:
    pass
PY
)
fi

[ -e "$CLI" ] && actions+=("remove $CLI (requires sudo)")
[ -e "$SERVICE" ] && actions+=("remove $SERVICE")
if [ "$REMOVE_APP" = "1" ]; then
  [ -e "$APP" ] && actions+=("remove $APP")
  [ -e "$USER_APP" ] && actions+=("remove $USER_APP")
  if [ -x "$LSREGISTER" ]; then
    actions+=("unregister $BUNDLE_ID from LaunchServices")
  fi
fi
if [ "$PURGE_STATE" = "1" ]; then
  for p in "${STATE_PATHS[@]}"; do
    [ -e "$p" ] && actions+=("remove $p")
  done
  if command -v tccutil >/dev/null 2>&1; then
    actions+=("reset TCC privacy records for $BUNDLE_ID (sandbox-folder authorizations)")
  fi
fi
if [ "$PURGE_PI_HISTORY" = "1" ]; then
  for d in "${VAULT_PI_PANEL_DIRS[@]}"; do
    actions+=("remove $d (Pi Panel history inside vault)")
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
  [ "$PURGE_PI_HISTORY" = "0" ] && \
    echo "  - Pass --purge-pi-history to also clear per-vault Pi Panel session history."
  exit 0
fi

echo "Will perform:"
for a in "${actions[@]}"; do echo "  - $a"; done
echo
if [ "$PURGE_PI_HISTORY" = "1" ] && [ "${#VAULT_PI_PANEL_DIRS[@]}" -gt 0 ]; then
  echo "WARNING: --purge-pi-history will delete files inside the .wenmei/ folder of each vault listed above."
else
  echo "Will NOT touch any vault folders or .wenmei/ subfolders inside them."
fi
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
  # Unregister from LaunchServices so "Open With" menus and file-type
  # bindings stop pointing at the now-deleted bundle. Failures are non-fatal.
  if [ -x "$LSREGISTER" ]; then
    "$LSREGISTER" -u "$APP" 2>/dev/null || true
    "$LSREGISTER" -u "$USER_APP" 2>/dev/null || true
    "$LSREGISTER" -kill -r -domain local -domain system -domain user 2>/dev/null || true
    echo "Unregistered $BUNDLE_ID from LaunchServices."
  fi
fi

# Per-vault Pi Panel history. We resolved paths above before any state.json
# deletion, so this is safe to run regardless of --purge-state ordering.
if [ "$PURGE_PI_HISTORY" = "1" ]; then
  if [ "${#VAULT_PI_PANEL_DIRS[@]}" -eq 0 ]; then
    echo "No per-vault Pi Panel history found (state.json missing or no vaults)."
  else
    for d in "${VAULT_PI_PANEL_DIRS[@]}"; do
      rm -rf "$d" && echo "Removed $d"
    done
  fi
fi

# Purge app-managed state
if [ "$PURGE_STATE" = "1" ]; then
  for p in "${STATE_PATHS[@]}"; do
    if [ -e "$p" ]; then
      rm -rf "$p" && echo "Removed $p"
    fi
  done
  echo "Purged desktop WebView storage; Zustand localStorage key 'wenmei-store' is cleared for the Tauri app."
  echo "Global-mode Pi Panel session history under sandbox-meta/ was included."
  # Clear TCC privacy records: every sandbox folder the user authorized via
  # the macOS file dialog created an entry under com.wenmei.desktop. Reset
  # All forgets every category (Documents, Desktop, Downloads, Files & Folders,
  # AppleEvents, etc.) for this bundle id. Quiet on systems without tccutil.
  if command -v tccutil >/dev/null 2>&1; then
    tccutil reset All "$BUNDLE_ID" 2>/dev/null \
      && echo "Reset TCC privacy records for $BUNDLE_ID." \
      || echo "tccutil reset for $BUNDLE_ID skipped or already empty."
  fi
fi

echo
echo "Done."
if [ "$PURGE_STATE" = "1" ]; then
  echo
  echo "Browser dev note: if you ran plain npm run dev in Chrome/Safari, clear that browser origin separately:"
  echo "  localStorage.removeItem('wenmei-store'); localStorage.removeItem('wenmei-mock-app-state'); location.reload();"
fi
