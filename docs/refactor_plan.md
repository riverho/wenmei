# Wenmei Backend Refactor Plan

> Generated from codebase analysis. Single-file Rust backend (`main.rs`, ~2295 lines) → 10-module architecture.

## Context

`src-tauri/src/main.rs` is a single compilation unit containing interleaved concerns:

- State management (`WenmeiState`, `AppState`)
- Vault/sandbox lifecycle
- Journal/event emission
- PTY terminal session management
- Pi RPC child process management
- File operations (path resolution, tree building, CRUD)
- Workspace search
- Background file polling
- CLI installation
- 1200+ lines of Tauri command handlers

No module boundaries exist. All state lives in `WenmeiState` which holds three unrelated lifetimes (terminal session, Pi session, app state). File operations mix FS work with state locks, journal writes, and event emission. The background poller has no error logging and no graceful degradation.

---

## Target Architecture

```
src-tauri/src/
├── main.rs           # entry, plugin wiring, global error emit
├── logging.rs        # tracing init, ErrorEvent type, error helpers
├── state.rs          # AppState, WenmeiState, LaunchMode/LaunchIntent, serialization
├── vault.rs          # vault/sandbox lifecycle, registry, workspace activation
├── file_ops.rs       # path resolution, tree building, CRUD commands
├── terminal.rs       # PTY session, boot script, terminal commands
├── pi_rpc.rs         # Pi child process, JSON-RPC framing, Pi panel commands
├── search.rs         # workspace + cross-vault search
├── journal.rs        # event types, append, list
├── polling.rs        # file signature, background poller with error logging
└── cli.rs            # shim bundling, install logic, CliStatus
```

---

## Phase 0: Logging Foundation

**Goal:** Structured error logging + error events to frontend. No logic changes.

### Cargo.toml additions

```toml
tracing = "0.1"
tracing-appender = "0.2"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
```

### `src-tauri/src/logging.rs`

```rust
use tracing::Level;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct ErrorEvent {
    pub code: String,
    pub component: String,
    pub vault_path: Option<String>,
    pub message: String,
    pub timestamp: String,
}

pub fn init(config_dir: &Path) {
    let log_dir = config_dir.join("logs");
    std::fs::create_dir_all(&log_dir).ok();

    let file_appender = RollingFileAppender::new(
        Rotation::DAILY,
        &log_dir,
        "wenmei.log",
    );

    tracing_subscriber::fmt()
        .with_writer(file_appender)
        .with_max_level(Level::INFO)
        .with_ansi(false)
        .init();
}

#[macro]
macro_rules! app_error {
    ($app:expr, $code:expr, $component:expr, $vault:expr, $msg:expr) => {{
        let err = ErrorEvent {
            code: $code.to_string(),
            component: $component.to_string(),
            vault_path: $vault.map(|v| v.to_string()),
            message: $msg.to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
        };
        tracing::error!(component=%err.component, vault_path=?err.vault_path, code=%err.code, "{}", err.message);
        let _ = $app.emit("app-error", &err);
    }};
}
```

### Key error codes

| Code                 | Component      | When                             |
| -------------------- | -------------- | -------------------------------- |
| `PERMISSION_DENIED`  | `vault_poller` | WalkDir returns permission error |
| `VAULT_NOT_FOUND`    | `vault_poller` | vault path doesn't exist         |
| `STATE_WRITE_FAILED` | `state`        | fail to serialize state.json     |
| `PI_NOT_FOUND`       | `pi_rpc`       | `which` fails to find `pi`       |
| `PI_SPAWN_FAILED`    | `pi_rpc`       | child process creation fails     |
| `PTY_SPAWN_FAILED`   | `terminal`     | portable-pty fork fails          |

---

## Phase 1: Extract `state.rs`

**Goal:** `AppState`, `WenmeiState`, `LaunchMode`, `LaunchIntent`, serialization/deserialization.

### Moves from `main.rs`

- Lines 13–202: All `use` imports, all struct/enum definitions
- Lines 214–338: `LaunchMode`, `LaunchIntent` enums and `parse_launch_intent()`
- Lines 546–679: `WenmeiState::new()`, registry loading, default vault creation

### New file: `src-tauri/src/state.rs`

```rust
pub struct AppState { /* ... all fields ... */ }
pub struct WenmeiState { /* ... all fields ... */ }
pub enum LaunchMode { Default, Document, Sandbox, Vault, Promote, Cli }
pub enum LaunchIntent { /* ... */ }

impl WenmeiState {
    pub fn new(app: &AppHandle, launch_intent: LaunchIntent) -> Result<Self, StateError> { ... }
    pub fn active_vault(&self) -> Option<&Vault> { ... }
    pub fn save(&self, app: &AppHandle) -> Result<(), StateError> { ... }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vault { /* ... */ }
pub struct Sandbox { /* ... */ }
pub struct AppPersistedState { /* ... */ }
// (all type definitions from main.rs lines 13–202)
```

### What stays in `main.rs`

- `main()` and `tauri::generate_handler![]` — thin entry point
- Command handler stubs that delegate to state methods

### Verification

```bash
cd src-tauri && cargo check
npm run check
```

---

## Phase 2: Extract `file_ops.rs`

**Goal:** Path resolution, tree building, all file CRUD operations.

### Moves from `main.rs`

- Lines 918–1094: `reject_unsafe_rel()`, `resolve_path()`, `ensure_parent()`, `relative_path()`, `build_tree_recursive()`, `unique_child()`
- Lines 1095–1257: `list_files`, `read_file`, `write_file`, `create_file`, `create_folder`, `rename_file`, `delete_file`, `move_file` commands

### New file: `src-tauri/src/file_ops.rs`

```rust
pub fn reject_unsafe_rel(rel: &str) -> Result<PathBuf, PathError> { ... }
pub fn resolve_path(vault: &Vault, rel: &str) -> Result<PathBuf, PathError> { ... }
pub fn build_tree_recursive(root: &Path, open_folders: &[String], etc) -> Result<Vec<FileNode>, FileError> { ... }

#[tauri::command] pub fn list_files(state: State<Mutex<WenmeiState>>, app: AppHandle) -> Result<Vec<FileNode>, String> { ... }
#[tauri::command] pub fn read_file(state: State<Mutex<WenmeiState>>, path: String) -> Result<FileContent, String> { ... }
// etc.
```

### Key change: error handling

```rust
// Before: silent filter
.filter_map(|e| e.ok())

// After: log and track
.filter_map(|e| match e {
    Ok(entry) => Some(entry),
    Err(e) if e.io_error_kind() == ErrorKind::PermissionDenied => {
        app_error!(app, "PERMISSION_DENIED", "file_ops", Some(&root), e.to_string());
        None
    }
    Err(e) => {
        tracing::warn!(path=?entry.path(), "read_dir error: {}", e);
        None
    }
})
```

---

## Phase 3: Extract `terminal.rs` + `pi_rpc.rs`

**Goal:** Separate PTY terminal from Pi RPC. These share `TerminalContext` so split carefully.

### Moves from `main.rs`

**`terminal.rs`:**

- Lines 178–185: `portable_pty` imports
- Lines 714–808: `TerminalContext`, `safe_meta_name()`, `active_terminal_context()`, path helpers
- Lines 919–980: `terminal_boot_script()`
- Lines 1948–2101: `terminal_start`, `terminal_write`, `terminal_resize`, `terminal_stop` commands
- Lines 2103–2169: `copy_file_path`, `vault_file_signature`, `start_file_polling`

**`pi_rpc.rs`:**

- Lines 187–193: Pi-related `use` imports
- Lines 1736–1798: `process_path()`, `find_pi_executable()`, `emit_pi_rpc_line()`
- Lines 1800–1946: `pi_panel_start`, `pi_panel_prompt`, `pi_panel_restart`, `pi_panel_abort`, `pi_panel_stop` commands

### Shared: `TerminalContext` lives in `terminal.rs`, `pi_rpc.rs` borrows it

```rust
// terminal.rs
pub struct TerminalContext { /* ... */ }
pub fn active_terminal_context(state: &WenmeiState, app: &AppHandle) -> Result<TerminalContext, TerminalError> { ... }

// pi_rpc.rs
use crate::terminal::active_terminal_context;
pub fn find_pi_executable() -> Result<PathBuf, PiError> { ... }
```

---

## Phase 4: Extract `vault.rs`, `journal.rs`, `search.rs`, `polling.rs`

### `vault.rs` — lines 329–543, 1492–1679

Registry management, workspace activation, sandbox creation, vault promotion.

### `journal.rs` — lines 809–917

Event types, `append_journal_event()`, `list_journal_events()`. Small module.

### `search.rs` — lines 1287–1347

`search_workspace`, `search_all_vaults`, `search_vaults`. Pure function, no state mutations.

### `polling.rs` — lines 2109–2169

**This is where error logging matters most.**

```rust
pub fn vault_file_signature(vault_path: &Path) -> Result<String, SignatureError> { ... }

pub fn start_file_polling(app: AppHandle, state: Arc<Mutex<WenmeiState>>) {
    loop {
        sleep(Duration::from_millis(1200));
        let vault = match active_vault(&state) {
            Some(v) => v,
            None => continue,
        };
        match vault_file_signature(&PathBuf::from(&vault.path)) {
            Ok(sig) => { /* compare, emit if changed */ }
            Err(e) => {
                tracing::error!(
                    component = "vault_poller",
                    vault_path = %vault.path,
                    code = e.code,
                    "{}",
                    e.message
                );
                app.emit("app-error", &e.to_error_event()).ok();
                // Option A: continue (retry next cycle)
                // Option B: set vault health flag + backoff
            }
        }
    }
}
```

---

## Phase 5: Extract `cli.rs`

**Goal:** Shim bundling, install script generation, `osascript` installer.

### Moves from `main.rs`

- Lines 1375–1490: `cli_integration_status`, `find_bundled_script`, `install_cli_integration` commands

### Dependencies

- `scripts/wenmei` (bundled in tauri.conf.json as resource)
- `scripts/install-cli.sh`
- `scripts/install-finder-service.sh`

---

## Phase 6: Thin `main.rs`

After all modules extracted, `main.rs` becomes:

```rust
mod logging;
mod state;
mod vault;
mod file_ops;
mod terminal;
mod pi_rpc;
mod search;
mod journal;
mod polling;
mod cli;

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let config_dir = app.path().app_data_dir().expect("no config dir");
            logging::init(&config_dir);
            let state = WenmeiState::new(app.handle().clone(), parse_launch_intent())
                .expect("failed to initialize state");
            app.manage(Mutex::new(state));
            polling::start_file_polling(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            file_ops::list_files,
            file_ops::read_file,
            // ... all commands from modules
        ])
        .build()
        .expect("failed to build app");
    app.run(|_event| {});
}
```

---

## Implementation Order

| Phase | Module                      | Risk   | Lines to move | Dependencies          |
| ----- | --------------------------- | ------ | ------------- | --------------------- |
| 0     | `logging.rs`                | Low    | ~80 new       | None                  |
| 1     | `state.rs`                  | Low    | ~280          | None                  |
| 2     | `file_ops.rs`               | Medium | ~280          | state                 |
| 3     | `terminal.rs` + `pi_rpc.rs` | High   | ~400          | state, logging        |
| 4     | `vault.rs`                  | Medium | ~300          | state                 |
| 4     | `journal.rs`                | Low    | ~100          | state                 |
| 4     | `search.rs`                 | Low    | ~70           | None                  |
| 4     | `polling.rs`                | Medium | ~120          | state, logging, vault |
| 5     | `cli.rs`                    | Low    | ~120          | state                 |
| 6     | `main.rs` cleanup           | Low    | —             | All                   |

**Total: ~1,750 lines moved across ~10 files**

---

## Verification After Each Phase

```bash
# Rust compiles
cd src-tauri && cargo check

# TypeScript compiles
npm run check

# Lint clean
npm run lint

# Format applied
npm run format

# Desktop still runs
npm run tauri dev
```

---

## What's Gained

1. **Testability** — `file_ops.rs`, `search.rs`, `journal.rs` have no mutable state and can be unit tested without Tauri
2. **Parallel work** — modules can be owned by different people once split
3. **Error logging** — structured `tracing` throughout with frontend error events
4. **Poller fix** — error handling + backoff/choke in `polling.rs` without touching other code
5. **Faster compiles** — `cargo check --lib` on changed modules vs full rebuild
6. **Clearer ownership** — each module has one job, imports are explicit

---

## What's Deliberately Not Split

- `AppState` / `WenmeiState` remain in `state.rs` — they own all sub-state. Splitting further would require lifetime refactoring that's not worth it yet.
- `TerminalContext` stays in `terminal.rs` — it bridges vault resolution + path computation, so extracting it just moves the mess.
- No async refactor — current blocking I/O in commands is fine for a desktop app. `tokio` is in `Cargo.toml` but not actively used in visible async code. Revisit only if concurrency becomes a bottleneck.
