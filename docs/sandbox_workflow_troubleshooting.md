# Sandbox / Vault Workflow Troubleshooting

> This document explains how Wenmei's vault and sandbox resolution works at runtime, where macOS permission dialogs can be triggered, and known issues in the startup path.

---

## 1. Startup: How Vault + Sandbox Are Resolved

Everything happens in `WenmeiState::new()` **before the Tauri window even opens**:

```
parse_launch_intent() → load state.json → resolve vault → resolve sandbox → write state.json
```

### `LaunchMode::Default` (double-click app, no file args)

```rust
fallback_vault = ~/Documents/Wenmei
config_dir     = ~/Library/Application Support/Wenmei
state_file     = config_dir/state.json
registry_file  = config_dir/sandboxes.json
```

| Step                | What happens                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Load state**      | Reads `state.json`. If missing, creates `AppState::with_default_vault(~/Documents/Wenmei)`                                                                                     |
| **Ensure sandbox**  | Calls `ensure_active_root_sandbox(&mut loaded, &active_vault_id)` — creates a "Root sandbox" with `root_path: "/"` for that vault                                              |
| **Init vault meta** | If `metadata_mode == "local"` (default), creates `.wenmei/terminal/logs`, `.wenmei/pi-sessions`, `.wenmei/trash`, `vault.json`, `journal.jsonl` **inside the vault directory** |
| **Write state**     | Saves `state.json` and `sandboxes.json` to `~/Library/Application Support/Wenmei`                                                                                              |

**On first launch, the app immediately touches two directories:**

1. `~/Library/Application Support/Wenmei` — no permission dialog needed
2. `~/Documents/Wenmei` and `~/Documents/Wenmei/.wenmei/...` — **this CAN trigger a macOS Documents folder permission dialog**

### `LaunchMode::Document` / `Sandbox` / `Vault` / `Promote` (CLI with a path)

```rust
launch.root = canonicalize(arg)  // e.g. /Users/river/notes
ensure_active_workspace(..., &root, open_mode, metadata_mode, ...)
```

This either finds an existing vault with that path, or creates a new one with a generated `vault-{timestamp}` ID.

---

## 2. Runtime Lookup: Every File Operation

Every Tauri command follows the same chain:

```rust
read_file(path)  →  active_vault(state)  →  resolve_path(vault, path)
write_file(...)  →  active_vault(state)  →  resolve_path(vault, path)
list_files()     →  active_vault(state)  →  build_tree_recursive(vault.path, ...)
```

### `active_vault()` — "Which vault am I in?"

```rust
app_state.vaults
    .iter()
    .find(|v| v.id == app_state.active_vault_id)
    .or_else(|| app_state.vaults.first())
```

Returns the vault marked `is_active`, or the first vault as fallback.

### `resolve_path()` — "Where does this relative path actually live?"

```rust
fn resolve_path(vault, rel) {
    let root = PathBuf::from(&vault.path);
    Ok(root.join(reject_unsafe_rel(rel)?))
}
```

### `reject_unsafe_rel()` — The security gate

```rust
fn reject_unsafe_rel(path) {
    // Rejects absolute paths
    // Rejects any component that is ParentDir (".."), Prefix, or RootDir
}
```

**All frontend paths are vault-relative.** The frontend never sees absolute paths. `read_file("/notes/idea.md")` resolves to `{vault.path}/notes/idea.md`.

---

## 3. The Background File Poller

Every **1.2 seconds**, a background thread runs:

```rust
fn start_file_polling(app) {
    loop {
        sleep(1200ms);
        let vault = active_vault(&state)?;
        let sig = vault_file_signature(&vault.path);  // WalkDir::new(&root)
        // ... compare with last signature, emit event if changed
    }
}
```

`vault_file_signature()` does a **full recursive `WalkDir`** of the vault root to compute a content signature. If the vault is in a location that requires macOS permissions (Documents, Desktop, Downloads, external drives, network shares), this **repeatedly scans the directory** and could trigger or re-trigger permission dialogs.

---

## 4. State Write Paths

| Data                                                       | File                                                  | When written                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| UI state + vault list + sandbox list + recent/pinned files | `~/Library/Application Support/Wenmei/state.json`     | On every `save_state()` — after file ops, vault switches, sandbox changes |
| Authorized sandbox registry                                | `~/Library/Application Support/Wenmei/sandboxes.json` | On vault/sandbox creation                                                 |
| Vault metadata                                             | `{vault}/.wenmei/vault.json`                          | On `init_vault_meta()` — first time vault is used                         |
| Journal                                                    | `{vault}/.wenmei/journal.jsonl`                       | On every file change, Pi action, terminal command                         |
| Trash                                                      | `{vault}/.wenmei/trash/`                              | On file delete                                                            |
| Pi sessions                                                | `{vault}/.wenmei/pi-sessions/{sandbox-id}/`           | On Pi start                                                               |

---

## 5. Why "Keeps Asking for Permission"

The permission cascade happens because of the following chain:

1. **First launch** → `WenmeiState::new()` → `init_vault_meta(~/Documents/Wenmei)` → **macOS asks: "Wenmei wants to access your Documents folder"**
2. **Frontend `init()`** → `listFiles()` → `fs::read_dir(~/Documents/Wenmei)` → **another access, or re-prompt if denied previously**
3. **Background poller** → every 1.2s, `WalkDir::new(vault.path)` → **if the permission was "Don't Allow" or is still pending, this could hang or re-prompt**
4. If the vault path was ever changed to something else (e.g., `~/Desktop/notes`, `~/Downloads`), each new path triggers its own permission dialog.

### Mixed-up vault settings

If `state.json` contains a vault path that was moved, deleted, or renamed, or if the app was previously launched with a CLI path that created a vault in an unexpected location, the poller will keep trying to access that stale path. There is currently no guard that skips inaccessible vault paths or degrades gracefully — the poller silently filters out errors (`filter_map(|e| e.ok())`) but continues retrying on the next iteration.

---

## 6. Bug Found in `RunEvent::Opened`

**File:** `src-tauri/src/main.rs`  
**Line:** 2270

```rust
// CURRENT (buggy):
.map(|rel| format!("/ {}", rel.to_string_lossy()))
//                      ^^^ space produces "/ notes/idea.md"

// SHOULD BE:
.map(|rel| format!("/{}", rel.to_string_lossy()))
//                      ^ no space produces "/notes/idea.md"
```

This bug won't crash the app, but file-open events from Finder or Apple Events will fail to resolve because the frontend receives a malformed vault-relative path with a leading space.

---

## Recommendations

1. **Graceful permission handling** — Check `fs::read_dir` / `WalkDir` results for permission errors and surface a user-visible message instead of silently swallowing errors.
2. **Poller backoff** — If a vault path is inaccessible, back off the poller (e.g., 10s instead of 1.2s) instead of retrying immediately.
3. **Fix `RunEvent::Opened` path formatting** — Remove the space in `format!("/ {}", ...)`.
4. **Vault health check on startup** — Verify the active vault path exists and is accessible before initializing the UI. If not, fall back to a known-safe location or prompt the user to select a new vault.

---

## 7. Tentative Fix: Auto-Create Vault for Non-Vault Files

**Problem:** When a user opens a non-vault markdown file via Finder double-click, Open With, or `wenmei` CLI, the file's parent directory is not a known vault. The old code silently stored the absolute path, which `read_file` then rejected as `ERR_UNSAFE_PATH` (absolute paths not allowed). The file open silently failed with no user feedback.

**Solution (implemented in `main.rs:2263-2327`):** When `RunEvent::Opened` receives a file outside all known vaults, auto-create a vault from the file's parent directory, activate it, scaffold the `.wenmei/` metadata dir, and emit `AUTO_VAULT_CREATED` error event. The file then opens normally via the newly created vault.

**Code path:**

```
RunEvent::Opened(url)
  → path.strip_prefix(vault) fails for ALL vaults
  → parent = path.parent()
  → create Vault { id, name, path: parent, is_active: true }
  → deactivate all other vaults
  → push new vault to app_state.vaults
  → activate it (app_state.active_vault_id = new id)
  → create .wenmei/ subdirs in parent
  → emit AUTO_VAULT_CREATED with vault_path
  → rel_path = path.strip_prefix(parent)
  → emit os-file-opened with vault-relative path
```

**Error codes now used:**

- `[ERR_UNSAFE_PATH]` — absolute path passed to `reject_unsafe_rel`
- `[ERR_VAULT_ESCAPE]` — `..` or root component in vault-relative path
- `FILE_OUTSIDE_VAULT` — (old path, no longer used after auto-vault fix)
- `AUTO_VAULT_CREATED` — non-vault file opened, vault auto-created from parent dir

**Limitation:** Does not persist the new vault to `state.json` before the event is emitted. The vault exists in memory but if the app crashes before the next `save_state()` call, the vault is lost. Acceptable for v0.1 — full persistence on auto-vault creation is a later improvement.

**Status:** Tentative. Tested via `open -na Wenmei.app --args /path/to/non-vault-file.md`. Build `Wenmei_0.1.0_x64.dmg`.
