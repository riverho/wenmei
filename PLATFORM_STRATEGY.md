# Platform Strategy

This document describes the trait-based platform abstraction used in the
Wenmei Rust backend. It explains why the pattern exists, how it works, and how
to extend it.

## Background

Wenmei started as a **macOS-first** Tauri app. Windows support was added later
by sprinkling `#[cfg(target_os = "...")]` blocks across `cli.rs`,
`terminal.rs`, `pi_rpc.rs`, `file_ops.rs`, and `main.rs`. This worked, but it
did not scale:

- `terminal_start()` was essentially **copy-pasted ~140 lines** for Windows
  (PowerShell) vs Unix (zsh). Any PTY bug fix had to be applied twice.
- Platform-specific code was scattered across five files, making it hard to see
  what differed per OS.
- Linux was an afterthought — it fell through `#[cfg(not(target_os =
  "windows"))]` cracks with no dedicated behavior.

## The pattern

We replaced inline `#[cfg]` blocks with a single `platform/` module that uses a
trait + compile-time type alias.

```
src-tauri/src/platform/
├── mod.rs      ← Platform trait + Current type alias
├── macos.rs    ← MacosPlatform
├── windows.rs  ← WindowsPlatform
└── linux.rs    ← LinuxPlatform
```

### The trait

`platform/mod.rs` defines one trait with every OS-specific operation:

```rust
pub trait Platform {
    fn reveal_in_folder(path: &Path) -> Result<(), String>;
    fn install_cli(app: &AppHandle) -> Result<String, String>;
    fn run_install_script(name: &str, app: &AppHandle) -> Result<String, String>;
    fn probe_cli_version(path: &str) -> Option<String>;
    fn build_terminal_command(cwd: &Path, log: &Path, pi: &Path) -> CommandBuilder;
    fn build_pty_command(commands: &[String]) -> CommandBuilder;
    fn pi_fallback_paths() -> Vec<PathBuf>;
    fn pi_process_path() -> String;
    fn pi_spawn_flags(cmd: &mut Command);
    fn pi_not_found_error() -> String;
    fn handle_run_event(app: &AppHandle, event: RunEvent);
}
```

### Compile-time dispatch

Only one module is compiled per target:

```rust
#[cfg(target_os = "macos")]
pub use macos::MacosPlatform as Current;
#[cfg(target_os = "windows")]
pub use windows::WindowsPlatform as Current;
#[cfg(target_os = "linux")]
pub use linux::LinuxPlatform as Current;
```

Call sites import the trait and use `platform::Current::method(...)`:

```rust
use crate::platform::Platform;

crate::platform::Current::reveal_in_folder(&full_path)?;
```

There is **zero runtime overhead** — the compiler monomorphizes every call.

## What changed in each file

| File | Before | After |
|------|--------|-------|
| `main.rs` | `#[cfg(target_os = "macos")] handle_run_event(...)` | Delegates to `platform::Current::handle_run_event` |
| `cli.rs` | 3 `#[cfg]` blocks, ~140 lines | 45 lines; delegates install/probe/script to trait |
| `file_ops.rs` | 3 `#[cfg]` blocks for reveal | 1-line delegation |
| `pi_rpc.rs` | `pi_user_bin`, `process_path`, `#[cfg]` fallbacks | Unified `find_pi_executable` using `pi_fallback_paths` + `pi_not_found_error` hooks |
| `terminal.rs` | `terminal_start` duplicated ~140 lines × 2 | **One unified function** — platform only provides `CommandBuilder` |

## Key design decisions

### 1. Trait methods are static, not instance-based

`MacosPlatform` and `WindowsPlatform` are zero-sized structs with no state. All
trait methods are associated functions (`fn foo() -> ...` rather than `fn
foo(&self)`). This keeps the API simple and avoids storing a platform object
anywhere.

### 2. The PTY lifecycle is unified; only the `CommandBuilder` differs

The biggest duplication was in `terminal_start()`. The session reuse check,
PTY `openpty()`, reader thread, backlog trimming, journal logging, and state
saving are identical on every OS. The only difference is how the shell command
is constructed (zsh vs PowerShell). So the trait only provides
`build_terminal_command()`, not the entire `terminal_start()` function.

### 3. Linux is a first-class citizen

`LinuxPlatform` has its own file and implements the full trait. It currently
shares a lot of behavior with `MacosPlatform` (bash terminal, Unix PATH), but
it has distinct behavior where it matters:

- `reveal_in_folder` uses `xdg-open` on the parent directory
- Terminal defaults to `/bin/bash` instead of `/bin/zsh`
- CLI install goes to `/usr/local/bin` without macOS-specific Finder services
- `handle_run_event` is a no-op (no Linux equivalent of macOS `RunEvent::Opened`)

## Adding a new platform

To add support for a new OS (e.g. FreeBSD):

1. Create `src-tauri/src/platform/freebsd.rs`
2. Implement the `Platform` trait for a `FreebsdPlatform` struct
3. Add the module and type alias in `platform/mod.rs`:

```rust
#[cfg(target_os = "freebsd")]
mod freebsd;
#[cfg(target_os = "freebsd")]
pub use freebsd::FreebsdPlatform as Current;
```

No other files need to change — the compile-time dispatch handles everything.

## WSL / Linux build from Windows

If you are on Windows but want to build and test the Linux binary inside WSL2
Ubuntu, you need a separate build environment.

### 1. Install system dependencies (inside WSL Ubuntu)

```bash
sudo apt update
sudo apt install -y \
    libwebkit2gtk-4.1-dev \
    libjavascriptcoregtk-4.1-dev \
    build-essential \
    curl \
    wget \
    file \
    libssl-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
```

### 2. Install Rust (inside WSL Ubuntu)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

### 3. Build (inside WSL Ubuntu)

```bash
cd /mnt/c/Users/$USER/Documents/Wenmei
npm install
npm run desktop:build
```

### 4. Run the Linux app

```bash
# Raw binary
./src-tauri/target/release/wenmei

# Or install the .deb package
sudo dpkg -i src-tauri/target/release/bundle/deb/*.deb
wenmei
```

### Known WSL runtime quirks

When running the Linux binary inside WSL2, you may see harmless graphics
warnings in the terminal:

```
libEGL warning: failed to get driver name for fd -1
MESA: error: ZINK: failed to choose pdev
libEGL warning: egl: failed to create dri2 screen
```

These come from WSLg's GPU passthrough and do not affect app functionality.

#### Vault / sandbox access on `/mnt/c/`

Wenmei needs full read/write/execute permissions on vault folders. The Windows
drive mount (`/mnt/c/...`) uses WSL's 9p filesystem, which can silently fail on
Unix permission operations (`chmod`, nested `mkdir`) that Wenmei's vault setup
relies on.

**Recommended:** Let Wenmei use the default vault inside WSL's native Linux
filesystem (`~/Documents/Wenmei`). If you want to use a Windows drive folder,
create it with explicit permissions first:

```bash
mkdir -p /mnt/c/Users/$USER/Documents/WenmeiVault
chmod 777 /mnt/c/Users/$USER/Documents/WenmeiVault
```

Then select that folder when the app prompts you for a vault.

### What the Linux build produces

| Artifact | Path |
|----------|------|
| Raw binary | `src-tauri/target/release/wenmei` |
| `.deb` package | `src-tauri/target/release/bundle/deb/wenmei_0.2.0_amd64.deb` |
| `.AppImage` | `src-tauri/target/release/bundle/appimage/wenmei_0.2.0_amd64.AppImage` |

> **Note:** The Linux build targets `x86_64-unknown-linux-gnu`. It will not
> produce `.msi` or `.exe` files — those come from the native Windows build
> only.
