use portable_pty::CommandBuilder;
use std::path::Path;
use tauri::AppHandle;

/// Platform-specific behaviour trait.
///
/// Each supported OS provides a zero-sized struct implementing this trait.
/// The `Current` type alias resolves at compile time to the correct
/// implementation, so there is zero runtime overhead.
pub trait Platform {
    /// Reveal `path` in the OS file manager (Finder / Explorer / etc.).
    fn reveal_in_folder(path: &Path) -> Result<(), String>;

    /// Install the `wenmei` CLI shim and any OS-level integrations.
    fn install_cli(app: &AppHandle) -> Result<String, String>;

    /// Run a bundled install script by name.
    fn run_install_script(name: &str, app: &AppHandle) -> Result<String, String>;

    /// Probe the version string of an installed CLI shim.
    fn probe_cli_version(path: &str) -> Option<String>;

    /// Build the [`CommandBuilder`] used to spawn the embedded terminal.
    fn build_terminal_command(cwd: &Path, log_file: &Path, pi_session_dir: &Path)
        -> CommandBuilder;

    /// Build the [`CommandBuilder`] used for one-off PTY commands.
    fn build_pty_command(commands: &[String]) -> CommandBuilder;

    /// Additional filesystem paths to search when looking for the global `pi`
    /// executable (searched *after* `$WENMEI_PI_PATH` and `which::which`).
    fn pi_fallback_paths() -> Vec<std::path::PathBuf>;

    /// The `PATH` environment variable injected into the Pi RPC process.
    fn pi_process_path() -> String;

    /// Apply any platform-specific spawn flags to the Pi RPC [`Command`].
    fn pi_spawn_flags(cmd: &mut std::process::Command);

    /// Error message shown when the global Pi executable cannot be found.
    fn pi_not_found_error() -> String;

    /// Handle Tauri [`RunEvent`]s delivered after the app has started.
    fn handle_run_event(app: &AppHandle, event: tauri::RunEvent);
}

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
pub use linux::LinuxPlatform as Current;
#[cfg(target_os = "macos")]
pub use macos::MacosPlatform as Current;
#[cfg(target_os = "windows")]
pub use windows::WindowsPlatform as Current;
