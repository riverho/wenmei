use std::path::PathBuf;
use std::thread;
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

use crate::journal::{append_journal_event, emit_files_changed};
use crate::state::{active_vault, WenmeiState};

fn vault_file_signature(vault_path: &str) -> Vec<String> {
    let root = PathBuf::from(vault_path);
    let mut out = vec![];
    for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let rel = crate::state::relative_path(path, &root);
        if rel == "/" || rel.starts_with(".wenmei") || rel.contains("/.wenmei/") {
            continue;
        }
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        if entry.file_type().is_file() {
            if let Ok(meta) = entry.metadata() {
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                out.push(format!("{}:{}:{}", rel, meta.len(), modified));
            }
        }
    }
    out.sort();
    out
}

pub fn start_file_polling(app: AppHandle) {
    thread::spawn(move || {
        let mut last_vault = String::new();
        let mut last_sig: Vec<String> = vec![];
        loop {
            thread::sleep(Duration::from_millis(1200));
            let state = app.state::<WenmeiState>();
            let vault = match active_vault(&state) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let sig = vault_file_signature(&vault.path);
            if last_vault.is_empty() {
                last_vault = vault.id;
                last_sig = sig;
                continue;
            }
            if last_vault != vault.id {
                last_vault = vault.id;
                last_sig = sig;
                emit_files_changed(&app, "vault.changed");
                continue;
            }
            if sig != last_sig {
                last_sig = sig;
                let _ = append_journal_event(
                    &state,
                    "files.changed",
                    "watcher",
                    None,
                    "Sandbox files changed".to_string(),
                    serde_json::json!({}),
                );
                emit_files_changed(&app, "watcher.changed");
            }
        }
    });
}
