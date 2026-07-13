use std::path::PathBuf;
use std::thread;
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

use crate::journal::{
    append_journal_event, emit_files_changed, emit_notification, NOTIFY_REVIEW_CHANGES,
};
use crate::review::observe_external_change;
use crate::state::{active_vault, WenmeiState};

/// Bound the walk: hidden directories are pruned at the walk level (never
/// descended into, not just filtered per-entry) and depth is capped, so the
/// poller touches as little of the disk as possible — large dot-dirs like
/// .git cost nothing and macOS TCC-protected paths aren't probed needlessly.
const MAX_WALK_DEPTH: usize = 8;

fn vault_file_signature(vault_path: &str) -> Vec<String> {
    let root = PathBuf::from(vault_path);
    let mut out = vec![];
    let walker = WalkDir::new(&root)
        .max_depth(MAX_WALK_DEPTH)
        .into_iter()
        .filter_entry(|e| {
            e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.')
        });
    for entry in walker.filter_map(|e| e.ok()) {
        let path = entry.path();
        let rel = crate::state::relative_path(path, &root);
        if rel == "/" || rel.starts_with(".wenmei") || rel.contains("/.wenmei/") {
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
            // Back off 5x while the window is unfocused: agent edits are
            // still caught (just up to ~6s later) and an idle app stops
            // hammering the disk / protected locations.
            let focused = app
                .get_webview_window("main")
                .and_then(|w| w.is_focused().ok())
                .unwrap_or(false);
            let interval = if focused { 1200 } else { 6000 };
            thread::sleep(Duration::from_millis(interval));
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
                let changed_paths: Vec<String> = sig
                    .iter()
                    .filter(|s| !last_sig.contains(s))
                    .chain(last_sig.iter().filter(|s| !sig.contains(s)))
                    .filter_map(|s| s.split(':').next().map(String::from))
                    .collect();
                last_sig = sig;
                let _ = append_journal_event(
                    &state,
                    "files.changed",
                    "watcher",
                    None,
                    "Sandbox files changed".to_string(),
                    serde_json::json!({}),
                );

                let mut review_entries = vec![];
                for path in changed_paths {
                    if let Ok(Some(entry)) = observe_external_change(&state, &path) {
                        review_entries.push(entry);
                    }
                }
                if !review_entries.is_empty() {
                    emit_notification(
                        &app,
                        NOTIFY_REVIEW_CHANGES,
                        "Agent changed files",
                        &format!(
                            "{} file(s) changed — awaiting review",
                            review_entries.len()
                        ),
                        None,
                    );
                    let _ = app.emit("changeset-observed", review_entries);
                }

                emit_files_changed(&app, "watcher.changed");
            }
        }
    });
}
