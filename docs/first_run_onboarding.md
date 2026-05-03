# Wenmei First-Run Onboarding + Script Organization Plan

## Context

Wenmei needs to guide users through setting up system-level integrations on first run. Currently the scripts exist but there's no onboarding UX. Additionally, Quick Look markdown preview requires a native plugin pipeline.

---

## Part 1: Script Organization

### Current state (`scripts/`)

```
scripts/
├── wenmei                 # CLI shim (bash) — the main entry point
├── install-cli.sh         # copies wenmei to /usr/local/bin
├── install-finder-service.sh  # creates Automator workflow for Finder service
└── uninstall.sh           # removes cli + service + optionally app + state
```

**Problems:**

- `install-cli.sh` and `install-finder-service.sh` do separate jobs but users need both
- No single "install everything" script
- No distinction between "CLI only" vs "Finder service only" vs "both"
- `uninstall.sh` covers all removal but the install side is fragmented

### Proposed structure

```
scripts/
├── install.sh              # Meta-script: runs all install sub-steps
├── uninstall.sh            # Existing — clean up all integrations
├── install-cli.sh          # Copies CLI shim to PATH (unchanged)
├── install-finder-service.sh  # Creates Automator workflow (unchanged)
├── install-quicklook.sh     # [stub — see Part 3]
├── verify.sh               # Checks what's currently installed
└── wenmei                   # CLI shim (unchanged)
```

### `install.sh` — the orchestrator

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Wenmei System Integration ==="
echo

# 1. CLI shim
echo "[1/2] Installing CLI shim (wenmei command)..."
bash "$SCRIPT_DIR/install-cli.sh"

# 2. Finder service
echo
echo "[2/2] Installing Finder Service (System Services menu)..."
bash "$SCRIPT_DIR/install-finder-service.sh"

echo
echo "Done. To use:"
echo "  - CLI:     wenmei /path/to/file.md  (from any terminal)"
echo "  - Finder:  Right-click file → Open in New Wenmei Window"
echo "  - Default: Get Info → Open with → Change All"
```

### `verify.sh` — check install status

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "=== Wenmei Install Status ==="

# CLI
if command -v wenmei >/dev/null 2>&1; then
  echo "✓ CLI shim: $(command -v wenmei)"
else
  echo "✗ CLI shim: not found (run install-cli.sh)"
fi

# Finder service
SVC="$HOME/Library/Services/Open in New Wenmei Window.workflow"
if [ -d "$SVC" ]; then
  echo "✓ Finder service: installed"
else
  echo "✗ Finder service: not found (run install-finder-service.sh)"
fi

# App
if [ -d "/Applications/Wenmei.app" ]; then
  echo "✓ App bundle: /Applications/Wenmei.app"
elif [ -d "$HOME/Applications/Wenmei.app" ]; then
  echo "✓ App bundle: ~/Applications/Wenmei.app"
else
  echo "✗ App bundle: not found"
fi
```

---

## Part 2: First-Run Onboarding UX

### Flow

```
First launch
  → Welcome screen (new user only, keyed off state.json empty)
    → "Welcome to Wenmei"
    → Brief explanation: local folders, vault, sandbox
    → [Get Started] button

  → Step 1: Install CLI
    → Shows: "Install the wenmei command in your terminal"
    → Code block: curl -sL https://... | bash  OR  run ./install-cli.sh
    → [Already installed] skip link
    → [Continue]

  → Step 2: System Services (Finder integration)
    → Shows: "Add 'Open in New Wenmei Window' to the Finder context menu"
    → [Install Service] button → runs install-finder-service.sh
    → [Skip for now]
    → Note: "After installing, enable it in System Settings → Keyboard → Shortcuts → Services → Files and Folders"

  → Step 3: Default App for Markdown
    → Shows: "Make Wenmei your default app for .md files"
    → [Open System Settings] button → leads to file association UI
    → [Skip for now]

  → Step 4: Pick a vault (optional)
    → "Open a folder as your first vault" — native folder picker
    → [Skip] → opens default ~/Documents/Wenmei

  → [Launch Wenmei]
```

### Implementation approach

**Option A: Native onboarding panel (React)**

- New `OnboardingModal` component, shown if no vaults in `state.json` AND `first_run_timestamp` not set
- Step wizard with progress dots
- Native folder picker via `@tauri-apps/plugin-dialog`
- `install-cli.sh` and `install-finder-service.sh` can be run via `invoke("install_cli")` Rust command that shells out to the scripts

**Option B: Single onboarding screen**

- New `FirstRunScreen` component replacing `App` for new users
- Sequential steps without a modal wizard

### Tauri commands for script execution

```rust
#[tauri::command]
fn run_install_script(script: &str) -> Result<String, String> {
    let output = Command::new("bash")
        .arg(script)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
```

### State tracking

In `AppState` (Rust + Zustand):

```rust
first_run_at: Option<String>,  // RFC3339 timestamp of first launch
onboarding_completed: bool,
cli_installed: bool,
finder_service_installed: bool,
```

On `install_cli` / `install_finder_service` success, update state and persist.

---

## Part 3: Quick Look Plugin

### The problem

macOS Quick Look (`spacebar` on a file in Finder) shows raw markdown source for `.md` files by default. Wenmei should render formatted markdown as a preview.

### Constraints

1. **Quick Look plugin must be a `.qlgenerator` bundle** — a native macOS plugin type. Tauri cannot generate this.
2. **Xcode is required** to build the plugin bundle.
3. **The plugin lives at a fixed path:** `~/Library/QuickLook/` or inside the app bundle at `Contents/Library/QuickLook/`.
4. **Signing requirements:** Both the app and the plugin need to be code-signed with the same Developer ID for the plugin to load.
5. **Not eligible for App Store** — Quick Look plugins with runtime code require a Developer ID, not App Store distribution.

### Proposed approach

**Option 1: Embedded qlgenerator in app bundle (preferred)**

1. Build the qlgenerator as a separate Xcode project targeting `macOS 11+`.
2. Use `pulldown-cmark` to render markdown to HTML.
3. Return `QLPreviewReply` with HTML content.
4. Place compiled `.qlgenerator` bundle in `src-tauri/quicklook/WenmeiPreview.qlgenerator/`.
5. Add `beforeBundleCommand` hook in `tauri.conf.json` to copy it into the app bundle at `Contents/Library/QuickLook/`.
6. Sign with `codesign --force --deep --sign "Developer ID"`.

**Option 2: User-installed qlgenerator (simpler, lower confidence)**

1. Build the `.qlgenerator` as part of Wenmei build but leave it in `scripts/`.
2. `install-quicklook.sh` copies it to `~/Library/QuickLook/`.
3. User runs `qlmanage -r` to register.
4. Lower barrier to entry but less seamless.

### File structure

```
src-tauri/
├── quicklook/
│   ├── WenmeiPreview.qlgenerator/   # Xcode project output (binary bundle)
│   ├── Sources/
│   │   ├── main.swift                # bundle entry, QLGenerator protocol
│   │   ├── PreviewProvider.swift     # generatePreviewForFileAtPath
│   │   └── MarkdownRenderer.swift    # pulldown-cmark → HTML
│   ├── project.yml                   # XcodeGen project.yml
│   └── README.md
└── tauri.conf.json
```

### tauri.conf.json additions

```json
{
  "bundle": {
    "macOS": {
      "minimumSystemVersion": "11.0",
      "frameworks": []
    }
  }
}
```

Post-build copy (in `build.rs` or shell script):

```bash
cp -r src-tauri/quicklook/WenmeiPreview.qlgenerator \
  "$(TARGET)/bundle/macos/Wenmei.app/Contents/Library/QuickLook/"
```

### Markdown rendering in Swift

```swift
import Foundation
import Quartz
import pulldown_cmark // or use a simple regex-based renderer for lightweight deps

class PreviewProvider: QLPreviewProvider {
    func providePreview(for request: QLFilePreviewRequest) async throws -> QLPreviewReply {
        let url = request.fileURL
        let markdown = try String(contentsOf: url, encoding: .utf8)
        let html = renderMarkdown(markdown) // pulldown-cmark or similar

        return QLPreviewReply(dataOfContentType: .html, contentSize: html.utf8.count) { reply in
            reply.appendData(html.data(using: .utf8)!)
        }
    }
}
```

### What to do right now

1. **Create `scripts/install-quicklook.sh`** as a stub that future us will implement.
2. **Document the architecture** so the work is ready to pick up.
3. **Add a flag to onboarding** for users who want to install Quick Look separately.
4. **Note in AGENTS.md** that Quick Look is a future integration item.

---

## Part 4: Implementation Order

| Step | What                                                                                       | Why                                               |
| ---- | ------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 0    | `scripts/install.sh` + `scripts/verify.sh`                                                 | Users can install all integrations in one command |
| 1    | Tauri `run_install_script` command + `installCli`/`installFinderService` frontend wrappers | Enables in-app install instead of manual terminal |
| 2    | `OnboardingModal` React component                                                          | First-run UX to guide users through setup         |
| 3    | `install-quicklook.sh` stub                                                                | Placeholder, will be filled by future work        |
| 4    | Quick Look Xcode project + `pulldown-cmark` rendering                                      | Long-term, after onboarding is stable             |

**First session target:** Steps 0-2. After this, `bash scripts/install.sh` and in-app "Install Integrations" button both work.

---

## Verification checklist

- [ ] `scripts/install.sh` runs both sub-scripts without error
- [ ] `scripts/verify.sh` correctly reports install status
- [ ] `invoke("run_install_script")` works from frontend
- [ ] Onboarding modal appears on fresh `state.json`
- [ ] After onboarding, `first_run_at` and `onboarding_completed` are persisted
- [ ] `install-quicklook.sh` exists as a stub with README explaining the full plan
