use std::path::PathBuf;
use tauri::State;

use crate::state::{active_vault, WenmeiState};

/// Open a file or folder in its own Wenmei instance. Spawns a fresh process
/// of the current executable with the absolute path as its launch argument —
/// the normal launch path (parse_launch_intent) then resolves it exactly like
/// a first launch from Explorer/Finder: folders become the window's vault
/// root, files open in Document mode. A separate process means the new
/// window carries its own backend state (active vault, terminals, Pi),
/// instead of fighting the parent window over process-global state.
///
/// Accepts either an absolute OS path (VaultMenu passes vault roots) or a
/// vault-relative `/rel` path (FileTree passes these), which is resolved
/// against the active vault.
#[tauri::command]
pub fn open_file_window(state: State<'_, WenmeiState>, path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("path is required".into());
    }

    let candidate = PathBuf::from(trimmed);
    let abs = if candidate.is_absolute() && candidate.exists() {
        candidate
    } else {
        let vault = active_vault(&state)?;
        PathBuf::from(vault.path).join(trimmed.trim_start_matches(['/', '\\']))
    };
    if !abs.exists() {
        return Err(format!("path not found: {}", abs.display()));
    }

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    std::process::Command::new(exe)
        .arg(&abs)
        .spawn()
        .map_err(|e| format!("could not launch new window: {e}"))?;

    Ok(())
}
