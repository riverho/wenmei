#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Wenmei"
SERVICE_DIR="$HOME/Library/Services"
SERVICE="$SERVICE_DIR/Open in New Wenmei Window.workflow"
CONTENTS="$SERVICE/Contents"

mkdir -p "$CONTENTS"
cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSServices</key>
  <array>
    <dict>
      <key>NSMenuItem</key>
      <dict><key>default</key><string>Open in New Wenmei Window</string></dict>
      <key>NSMessage</key><string>runWorkflowAsService</string>
      <key>NSRequiredContext</key><dict></dict>
      <key>NSSendFileTypes</key>
      <array>
        <string>public.folder</string>
        <string>net.daringfireball.markdown</string>
        <string>public.plain-text</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
PLIST

cat > "$CONTENTS/document.wflow" <<'WFL'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>actions</key>
  <array>
    <dict>
      <key>action</key>
      <dict>
        <key>AMAccepts</key><dict><key>Container</key><string>List</string><key>Optional</key><false/><key>Types</key><array><string>com.apple.cocoa.path</string></array></dict>
        <key>AMActionVersion</key><string>2.0.3</string>
        <key>AMApplication</key><array><string>Automator</string></array>
        <key>AMParameterProperties</key><dict><key>COMMAND_STRING</key><dict/></dict>
        <key>AMProvides</key><dict><key>Container</key><string>List</string><key>Types</key><array><string>com.apple.cocoa.string</string></array></dict>
        <key>ActionBundlePath</key><string>/System/Library/Automator/Run Shell Script.action</string>
        <key>ActionName</key><string>Run Shell Script</string>
        <key>ActionParameters</key>
        <dict>
          <key>COMMAND_STRING</key><string>for f in "$@"; do
  if [ -x "$HOME/.local/bin/wenmei" ]; then
    "$HOME/.local/bin/wenmei" --new-window "$f"
  elif command -v wenmei >/dev/null 2>&amp;1; then
    wenmei --new-window "$f"
  else
    open -n -a Wenmei --args "$f"
  fi
done</string>
          <key>CheckedForUserDefaultShell</key><true/>
          <key>inputMethod</key><integer>1</integer>
          <key>shell</key><string>/bin/zsh</string>
          <key>source</key><string></string>
        </dict>
        <key>BundleIdentifier</key><string>com.apple.RunShellScript</string>
        <key>CFBundleVersion</key><string>2.0.3</string>
      </dict>
    </dict>
  </array>
  <key>connectors</key><dict/>
  <key>workflowMetaData</key>
  <dict>
    <key>serviceInputTypeIdentifier</key><string>com.apple.Automator.fileSystemObject</string>
    <key>serviceOutputTypeIdentifier</key><string>com.apple.Automator.nothing</string>
    <key>serviceProcessesInput</key><integer>0</integer>
  </dict>
</dict>
</plist>
WFL

echo "Installed Finder Service: $SERVICE"
echo "If it does not appear immediately: System Settings → Keyboard → Keyboard Shortcuts → Services → Files and Folders."
