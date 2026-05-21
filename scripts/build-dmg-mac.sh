#!/usr/bin/env bash
# build-dmg-mac.sh — Build the Wenmei DMG with a clickable Uninstall icon.
#
# Tauri's built-in DMG bundler can't add extra files. To put an Uninstall
# entry into the DMG (so users can clean an existing install before dragging
# in the new version) we let Tauri build just the .app, then stage a custom
# DMG layout ourselves with hdiutil:
#
#   /Volumes/Wenmei <version>/
#     Wenmei.app               ← drag this to Applications
#     Applications      →      ← symlink
#     Uninstall Wenmei.command ← double-click to run uninstall-macos.sh
#     uninstall-macos.sh       ← the actual script the .command shells to
#
# Usage:
#   scripts/build-dmg-mac.sh aarch64    (Apple Silicon, default)
#   scripts/build-dmg-mac.sh x86_64     (Intel)
#
# Assumes `tauri build --target <arch>-apple-darwin --bundles app` has
# already produced the .app at the expected target path.
set -euo pipefail

ARCH="${1:-aarch64}"
case "$ARCH" in
  aarch64|x86_64) ;;
  *) echo "Unsupported arch: $ARCH (expected aarch64 or x86_64)" >&2; exit 2 ;;
esac

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="$ROOT_DIR/src-tauri/target/${ARCH}-apple-darwin/release/bundle"
APP_PATH="$TARGET_DIR/macos/Wenmei.app"
DMG_OUT_DIR="$TARGET_DIR/dmg"

if [ ! -d "$APP_PATH" ]; then
  echo "Wenmei.app not found at $APP_PATH" >&2
  echo "Run: tauri build --target ${ARCH}-apple-darwin --bundles app" >&2
  exit 1
fi

VERSION=$(node -p "require('$ROOT_DIR/package.json').version")
DMG_PATH="$DMG_OUT_DIR/Wenmei_${VERSION}_${ARCH}.dmg"

STAGE=$(mktemp -d -t wenmei-dmg)
trap 'rm -rf "$STAGE"' EXIT

# Use ditto rather than cp -R: preserves resource forks, extended attrs, and
# code-signing metadata on the .app bundle.
ditto "$APP_PATH" "$STAGE/Wenmei.app"
ln -s /Applications "$STAGE/Applications"
cp "$ROOT_DIR/scripts/uninstall-macos.sh" "$STAGE/uninstall-macos.sh"
cp "$ROOT_DIR/scripts/dmg/Uninstall Wenmei.command" "$STAGE/Uninstall Wenmei.command"
chmod +x "$STAGE/uninstall-macos.sh" "$STAGE/Uninstall Wenmei.command"

mkdir -p "$DMG_OUT_DIR"
rm -f "$DMG_PATH"

# UDZO = zlib-compressed read-only DMG, the standard format for distribution.
hdiutil create \
  -volname "Wenmei ${VERSION}" \
  -srcfolder "$STAGE" \
  -ov \
  -format UDZO \
  -fs HFS+ \
  "$DMG_PATH" >/dev/null

echo "Built: $DMG_PATH"
