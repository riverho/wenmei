# Packaging Wenmei

This document covers the standard build → distribute → install procedure for
the Wenmei desktop app on macOS.

For the Windows build (GitHub Actions, MSI/NSIS) and release tagging
conventions, see [`CI_CD.md`](./CI_CD.md).

## Distribution format

Wenmei ships as a **DMG** (`Wenmei_<version>_<arch>.dmg`) containing the
`Wenmei.app` bundle. The app bundles its own install scripts and exposes an
in-app "Install Shell Integration" action — there is no separate `.pkg`.

Why DMG over PKG:

- Native Mac drag-to-Applications UX
- Tauri produces it directly (no extra tooling)
- Avoids the harder Gatekeeper requirements that come with `.pkg`
- Shell-integration files (`/usr/local/bin/wenmei`, `~/Library/Services/`)
  are installed on demand from inside the app, so a DMG is sufficient

If Wenmei ever needs to install daemons, kernel extensions, or system-wide
helpers, switch to `.pkg`.

## Building the DMG

```bash
npm run desktop:build
```

Outputs:

```
src-tauri/target/release/bundle/macos/Wenmei.app
src-tauri/target/release/bundle/dmg/Wenmei_0.1.0_aarch64.dmg
```

Bundling is configured in `src-tauri/tauri.conf.json`:

```jsonc
"bundle": {
  "active": true,
  "targets": ["app", "dmg"],
  "resources": [
    "../scripts/wenmei",
    "../scripts/install-cli.sh",
    "../scripts/install-finder-service.sh"
  ],
  "macOS": { "minimumSystemVersion": "11.0" }
}
```

The three scripts are copied into the app bundle at
`Wenmei.app/Contents/Resources/_up_/scripts/` so the in-app installer can
find them at runtime.

## Install procedure (end-user)

1. Mount `Wenmei_<version>_<arch>.dmg`.
2. Drag `Wenmei.app` to **Applications**.
3. Launch Wenmei from Applications.
   - On first run, macOS Gatekeeper may block the app because it isn't
     signed. Right-click the app icon → **Open** → confirm. This is a
     one-time per-machine prompt.
4. **Optional** — install shell integration:
   - Click the chain-link icon in the app header
     (only visible when integration is not yet installed)
   - macOS prompts for an admin password (required to write to
     `/usr/local/bin`)
   - The button disappears once installed

What "Install Shell Integration" does:

- Copies the `wenmei` shim to `/usr/local/bin/wenmei`
- Installs the `Open in New Wenmei Window` Finder service to
  `~/Library/Services/`

After that:

```bash
wenmei /path/to/folder                  # opens that folder as a registry sandbox
wenmei /path/to/note.md                 # opens parent folder, selects file
wenmei --new-window /path/to/folder     # explicit independent window/session
wenmei create /path/to/new-note.md      # creates the file, then opens it
wenmei edit /path/to/maybe-missing.md   # creates if missing, then opens it
wenmei mkdir /path/to/new-folder        # creates the folder, then opens it
wenmei sandbox /path/to/folder          # authorizes folder with global metadata
wenmei vault /path/to/folder            # promotes folder with local .wenmei metadata
wenmei promote /path/to/folder          # same promotion intent, explicit wording
wenmei composite Name /a /b             # one authorized sandbox across roots
```

In Finder, right-click any folder or `.md` file → **Services → Open in
New Wenmei Window**.

Regular folder opens and Finder service opens use the global sandbox registry.
They do not create `.wenmei/` in every folder. Local `.wenmei/` metadata is
created only by explicit vault/promotion flows.

## Manual install (without using the in-app button)

If you prefer to install scripts directly from the source repo:

```bash
./scripts/install-cli.sh             # /usr/local/bin/wenmei
./scripts/install-finder-service.sh  # ~/Library/Services
```

Both scripts use sudo only when needed and refuse to clobber unrelated
files.

## Code signing & notarization

Currently unsigned. For distribution beyond yourself, sign the app and DMG
with an Apple Developer ID and notarize with Apple. Recommended steps once
you have a Developer ID:

```bash
# 1. Sign
codesign --deep --force --sign "Developer ID Application: Your Name (TEAMID)" \
  --options runtime \
  --entitlements src-tauri/entitlements.plist \
  src-tauri/target/release/bundle/macos/Wenmei.app

# 2. Notarize the DMG
xcrun notarytool submit src-tauri/target/release/bundle/dmg/Wenmei_*.dmg \
  --apple-id you@example.com --team-id TEAMID --password "@keychain:notary" --wait

# 3. Staple
xcrun stapler staple src-tauri/target/release/bundle/dmg/Wenmei_*.dmg
```

Tauri can also do signing automatically via
`bundle.macOS.signingIdentity` once the cert is in Keychain.

Until then, end-users see Gatekeeper warnings on first launch (right-click
→ Open one-time bypass).

## Versioning

Bumping the version is two edits:

- `package.json` → `"version"`
- `src-tauri/tauri.conf.json` → `"version"`

Both must match. The DMG filename includes the version number. The version
bump must also match the release tag — see [`CI_CD.md`](./CI_CD.md#cutting-a-release).

## Single-instance behavior

Each `wenmei <path>` invocation launches a **new Wenmei process/window**
(`open -na`). `--new-window` is accepted for explicitness and future
compatibility, but it currently matches the default behavior. If you want one
Wenmei process with multiple windows for different vaults, add the
`tauri-plugin-single-instance` plugin and an `on_new_intent` handler that opens
a new window when a second invocation arrives.

## Removing shell integration

```bash
sudo rm /usr/local/bin/wenmei
rm -rf "$HOME/Library/Services/Open in New Wenmei Window.workflow"
```

Then restart Finder for the service to disappear from the Services menu:
`killall Finder`.
