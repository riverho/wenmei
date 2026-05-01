#!/usr/bin/env bash
# Install the `wenmei` CLI shim to a directory on PATH.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$SCRIPT_DIR/wenmei"
DEST_DIR="${WENMEI_BIN_DIR:-/usr/local/bin}"
DEST="$DEST_DIR/wenmei"

if [ ! -f "$SOURCE" ]; then
  echo "Source shim missing: $SOURCE" >&2
  exit 1
fi

mkdir -p "$DEST_DIR" 2>/dev/null || true

if [ -w "$DEST_DIR" ]; then
  cp "$SOURCE" "$DEST"
  chmod +x "$DEST"
else
  echo "Need sudo to write to $DEST_DIR..."
  sudo cp "$SOURCE" "$DEST"
  sudo chmod +x "$DEST"
fi

echo "Installed: $DEST"
echo "Try:  wenmei /path/to/folder"
