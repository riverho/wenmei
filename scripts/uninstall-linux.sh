#!/usr/bin/env bash
# uninstall-linux.sh — Remove Wenmei and its Linux desktop integrations.
#
# Detects whether Wenmei was installed via DEB or RPM and removes accordingly.
#
# By default removes:
#   - The Wenmei package (DEB or RPM)
#   - Desktop file and MIME associations
#
# Optional flags (off by default):
#   --purge-state   Also remove app config, caches, and WebView storage.
#   --purge-pi-history
#                   Also delete per-vault Pi Panel session history.
#   --yes / -y      Skip confirmation prompts
#
# Your vault folders and markdown files are NEVER touched.
set -euo pipefail

PURGE_STATE=0
PURGE_PI_HISTORY=0
ASSUME_YES=0

for arg in "$@"; do
  case "$arg" in
    --purge-state) PURGE_STATE=1 ;;
    --purge-pi-history) PURGE_PI_HISTORY=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help)
      sed -n '2,17p' "$0"
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

declare -a actions=()

# Detect package manager
IS_DEB=0
IS_RPM=0
if command -v dpkg >/dev/null 2>&1 && dpkg -l wenmei >/dev/null 2>&1; then
  IS_DEB=1
elif command -v rpm >/dev/null 2>&1 && rpm -q Wenmei >/dev/null 2>&1; then
  IS_RPM=1
fi

if [ "$IS_DEB" = "1" ]; then
  actions+=("remove DEB package: wenmei")
elif [ "$IS_RPM" = "1" ]; then
  actions+=("remove RPM package: Wenmei")
else
  actions+=("remove AppImage / manual install (best effort)")
fi

# App data locations
STATE_PATHS=(
  "$HOME/.config/Wenmei"
  "$HOME/.config/com.wenmei.desktop"
  "$HOME/.cache/Wenmei"
  "$HOME/.cache/com.wenmei.desktop"
  "$HOME/.local/share/Wenmei"
  "$HOME/.local/share/com.wenmei.desktop"
)

# Per-vault Pi Panel history
STATE_JSON="$HOME/.local/share/Wenmei/state.json"
if [ ! -f "$STATE_JSON" ]; then
  STATE_JSON="$HOME/.config/Wenmei/state.json"
fi

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

if [ "$PURGE_STATE" = "1" ]; then
  for p in "${STATE_PATHS[@]}"; do
    [ -e "$p" ] && actions+=("remove $p")
  done
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
  echo "  - Wenmei does not appear to be installed."
  [ "$PURGE_STATE" = "0" ] && echo "  - Pass --purge-state to also remove app config and caches."
  [ "$PURGE_PI_HISTORY" = "0" ] && echo "  - Pass --purge-pi-history to also clear per-vault Pi Panel session history."
  exit 0
fi

echo "Will perform:"
for a in "${actions[@]}"; do echo "  - $a"; done
echo

if [ "$PURGE_PI_HISTORY" = "1" ] && [ "${#VAULT_PI_PANEL_DIRS[@]}" -gt 0 ]; then
  echo "WARNING: --purge-pi-history will delete files inside the .wenmei/ folder of each vault."
else
  echo "Will NOT touch any vault folders or .wenmei/ subfolders inside them."
fi
echo

if ! confirm "Proceed?"; then
  echo "Aborted."
  exit 0
fi

# Remove package
if [ "$IS_DEB" = "1" ]; then
  sudo apt remove -y wenmei && echo "Removed DEB package: wenmei"
  sudo apt autoremove -y 2>/dev/null || true
elif [ "$IS_RPM" = "1" ]; then
  sudo rpm -e Wenmei && echo "Removed RPM package: Wenmei"
fi

# If manual/AppImage, try to clean up desktop file
if [ "$IS_DEB" = "0" ] && [ "$IS_RPM" = "0" ]; then
  rm -f "$HOME/.local/share/applications/Wenmei.desktop"
  rm -f "$HOME/.local/share/applications/wenmei.desktop"
fi

# Update desktop database
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
  update-desktop-database /usr/share/applications 2>/dev/null || true
fi

# Remove MIME association (best effort)
if command -v xdg-mime >/dev/null 2>&1; then
  CURRENT_DEFAULT=$(xdg-mime query default text/markdown 2>/dev/null || true)
  if [ "$CURRENT_DEFAULT" = "Wenmei.desktop" ] || [ "$CURRENT_DEFAULT" = "wenmei.desktop" ]; then
    xdg-mime default null.desktop text/markdown 2>/dev/null || true
    echo "Cleared default app for text/markdown"
  fi
fi

# Purge app data
if [ "$PURGE_STATE" = "1" ]; then
  for p in "${STATE_PATHS[@]}"; do
    if [ -e "$p" ]; then
      rm -rf "$p" && echo "Removed $p"
    fi
  done
  echo "Purged app state and caches."
fi

# Purge Pi history
if [ "$PURGE_PI_HISTORY" = "1" ]; then
  if [ "${#VAULT_PI_PANEL_DIRS[@]}" -eq 0 ]; then
    echo "No per-vault Pi Panel history found."
  else
    for d in "${VAULT_PI_PANEL_DIRS[@]}"; do
      rm -rf "$d" && echo "Removed $d"
    done
  fi
fi

echo
echo "Done."
