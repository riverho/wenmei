use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{WebviewUrl, WebviewWindowBuilder};

use crate::state::WenmeiState;

/// Percent-encode a query-string value (RFC 3986 unreserved set passes
/// through; everything else becomes %XX).
fn encode_query_value(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Open a file in its own Wenmei window (multi-instance). The window boots at
/// `index.html?openFile=<rel>` and the frontend reads the param on init.
#[tauri::command]
pub fn open_file_window(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("path is required".into());
    }
    let started_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let label = format!("file-window-{started_at}");
    let name = path.rsplit('/').next().unwrap_or(&path);
    let url = format!("index.html?openFile={}", encode_query_value(&path));

    WebviewWindowBuilder::new(&app, label, WebviewUrl::App(url.into()))
        .title(format!("Wenmei - {name}"))
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Map single-instance argv file paths to vault-relative `/rel` form. The
/// frontend's `read_file` takes vault-relative paths, so absolute paths
/// inside a known vault are rewritten (matching platform/macos.rs). Paths
/// outside every vault pass through unchanged.
pub fn resolve_open_paths(app: &tauri::AppHandle, argv: &[String]) -> Vec<String> {
    use tauri::Manager;
    argv.iter()
        .map(|arg| {
            let path = std::path::Path::new(arg);
            if let Some(state) = app.try_state::<WenmeiState>() {
                if let Ok(app_state) = state.app_state.lock() {
                    for vault in &app_state.vaults {
                        if let Ok(rel) = path.strip_prefix(&vault.path) {
                            let rel = rel.to_string_lossy().replace('\\', "/");
                            return format!("/{}", rel);
                        }
                    }
                }
            }
            arg.clone()
        })
        .collect()
}
