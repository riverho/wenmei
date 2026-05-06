# Cross-Platform File Association Debrief & macOS Handoff

## What We Built

### 1. Platform-aware onboarding (`src/components/Lightbox.tsx`)
- Added `get_platform()` Tauri command (`platform/mod.rs`, `src/lib/tauri-bridge.ts`)
- Onboarding now shows OS-appropriate options:
  - **macOS**: CLI + Finder Service + Quick Look (original `.sh` script flow)
  - **Windows/Linux**: CLI only with correct descriptions

### 2. File association — Linux DEB/RPM
- Custom `.desktop` template (`src-tauri/templates/Wenmei.desktop`) with:
  - `Exec=wenmei %F` — file paths passed to the app
  - `MimeType=text/markdown;text/plain;text/x-markdown;`
- `deb-postinstall.sh` — runs `xdg-mime default` + `update-desktop-database`
- `rpm-postinstall.sh` — same for RPM
- Configured in `tauri.conf.json` via `desktopTemplate` and `postInstallScript`

### 3. Single-instance + file-open handling (all platforms)
- Added `tauri-plugin-single-instance = "2"` to `Cargo.toml`
- Registered as **first plugin** in `main.rs`:
  ```rust
  .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      if argv.len() > 1 {
          let _ = app.emit("single-instance", argv[1..].to_vec());
      }
  }))
  ```
- Frontend (`src/App.tsx`) listens for `single-instance` event and opens the file
- **Cold start** (app not running): handled by existing `getInitialFile()` which parses `std::env::args()`
- **Warm start** (app running): single-instance plugin blocks second instance and emits event

### 4. Windows build
- Produced `.msi` (5.4 MB) and `.exe` (3.4 MB) with single-instance plugin included
- `fileAssociations` in `tauri.conf.json` registers `.md`/`.markdown`/`.mdown`/`.mkd` with ProgId

### 5. Linux build (WSL)
- Produced `.deb` (6.5 MB), `.rpm` (6.5 MB), `.AppImage` (80.9 MB) with single-instance plugin
- Verified desktop files and post-install scripts are embedded correctly

---

## macOS Expected Behavior

macOS file opening works differently from Windows/Linux:

| Scenario | macOS Mechanism | Our Handler |
|---|---|---|
| Double-click `.md` while app **not running** | `RunEvent::Opened` fires on first launch | `platform/macos.rs::handle_run_event` → emits `os-file-opened` |
| Double-click `.md` while app **running** | `RunEvent::Opened` fires on existing instance | Same — macOS delivers to existing instance natively |
| `open -a Wenmei file.md` from Terminal | `RunEvent::Opened` fires | Same |
| Cold-start CLI `wenmei file.md` | `std::env::args()` parsed in `state.rs` | `getInitialFile()` command |

**Key point:** macOS does **not** spawn a second process when opening a file. The OS routes `open` events to the existing app instance via `RunEvent::Opened`. This is why macOS never needed `tauri-plugin-single-instance` for file-open handling.

---

## macOS Open Questions / Handoff Items

### 1. Single-instance plugin on macOS — test for conflicts

`tauri-plugin-single-instance` **does** support macOS (D-Bus on Linux, named mutex on Windows, Apple Events on macOS). It might:

- **A)** Be harmless and redundant on macOS (plugin blocks second instance, but OS already does this)
- **B)** Emit a **duplicate** `single-instance` event alongside the existing `os-file-opened` event when a file is opened while running
- **C)** Interfere with `RunEvent::Opened` delivery

**Action required:** Test on macOS by:
1. Building `npm run desktop:build:mac`
2. Install the `.app` or run from `.dmg`
3. Double-click a `.md` file while Wenmei is already running
4. Check Console/devtools for whether **both** `os-file-opened` and `single-instance` events fire
5. If duplicate events fire, deduplicate in `App.tsx` or disable the plugin on macOS:
   ```rust
   #[cfg(not(target_os = "macos"))]
   .plugin(tauri_plugin_single_instance::init(...))
   ```

### 2. Known macOS file-open bug (pre-existing)

From `AGENTS.md`:
> `src-tauri/src/main.rs:2270` — `RunEvent::Opened` path formatting has a space: `format!("/ {}", rel)` should be `format!("/{}", rel)`. Finder file-open events arrive with malformed vault-relative paths.

**Action required:** Fix the stray space in `platform/macos.rs`:
```rust
// Before (buggy):
format!("/ {}", rel)
// After (fixed):
format!("/{}", rel)
```

### 3. macOS build

No macOS build has been produced during this session. The single-instance plugin and frontend changes are in place, but:

- `cargo check` has not been run for `aarch64-apple-darwin`
- No `.dmg` or `.app` has been built

**Action required:** On a Mac (or CI with macOS runner):
```bash
npm run desktop:build:mac
```

### 4. File association verification on macOS

Tauri's `fileAssociations` with `rank: "Default"` on macOS sets `CFBundleTypeRole = Editor` and `LSHandlerRank = Default` in `Info.plist`. This should:
- Register Wenmei as an editor for `.md` files
- Appear in "Open With" menu
- Work via Finder double-click

**Action required:** Verify after build:
1. Install `.app` to `/Applications`
2. Right-click a `.md` file → Get Info → "Open with:" should show Wenmei
3. Double-click opens the file in Wenmei
4. While Wenmei is running, double-click another `.md` — it should open in the existing window

### 5. Onboarding macOS flow

The onboarding was updated to be platform-aware but the **macOS `.sh` script installation flow was not modified**. It still:
- Runs `install.sh` for CLI
- Runs `install-finder-service.sh` for Finder Service
- Runs `install-quicklook.sh` for Quick Look

**Action required:** Verify these scripts still work correctly with the current app bundle structure.

---

## Files Changed This Session

| File | Change |
|---|---|
| `src-tauri/Cargo.toml` | Added `tauri-plugin-single-instance = "2"` |
| `src-tauri/src/main.rs` | Registered single-instance plugin first; imported `tauri::Emitter` |
| `src/App.tsx` | Added `single-instance` event listener; opens file from argv |
| `src-tauri/tauri.conf.json` | Added `linux.deb/rpm` `desktopTemplate` and `postInstallScript` |
| `src-tauri/templates/Wenmei.desktop` | Handlebars template with `%F` and full MimeType |
| `src-tauri/templates/deb-postinstall.sh` | `xdg-mime default` + `update-desktop-database` |
| `src-tauri/templates/rpm-postinstall.sh` | Same for RPM |
| `src/lib/tauri-bridge.ts` | Added `PlatformName` type + `getPlatform()` |
| `src/store/appStore.ts` | Added `platform` / `setPlatform` |
| `src/components/Lightbox.tsx` | Platform-aware onboarding (macOS vs Win/Linux) |
| `docs/BUILD.md` | Added Linux file association tests + troubleshooting |
| `AGENTS.md` | Documented `single-instance` event |

---

## Build Artifact Locations

| Platform | Path |
|---|---|
| Windows MSI | `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/` |
| Windows NSIS | `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/` |
| Linux DEB | `src-tauri/target/release/bundle/deb/` |
| Linux RPM | `src-tauri/target/release/bundle/rpm/` |
| Linux AppImage | `src-tauri/target/release/bundle/appimage/` |
| macOS (not built) | `src-tauri/target/release/bundle/macos/` + `dmg/` |

---

## Next Steps for macOS Owner

1. Fix the `format!("/ {}", rel)` → `format!("/{}", rel)` bug in `platform/macos.rs`
2. Build macOS: `npm run desktop:build:mac`
3. Test Finder double-click (cold start + warm start)
4. Check for duplicate `os-file-opened` + `single-instance` events
5. If duplicates occur, gate the single-instance plugin to non-macOS:
   ```rust
   #[cfg(not(target_os = "macos"))]
   .plugin(tauri_plugin_single_instance::init(...))
   ```
6. Verify onboarding `.sh` scripts still install correctly
7. Update `docs/BUILD.md` macOS test checklist with findings
