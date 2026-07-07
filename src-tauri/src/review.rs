use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, State};

use crate::file_ops::resolve_path;
use crate::journal::{
    append_journal_event, emit_files_changed, KIND_REVIEW_APPROVED, KIND_REVIEW_REJECTED,
    KIND_REVIEW_SESSION_CLOSED, KIND_REVIEW_SESSION_STARTED,
};
use crate::state::{active_vault, relative_path, WenmeiState};

const STAGING_DIR: &str = ".wenmei/staging";
const STAGING_CAP_MB: u64 = 200;
const LARGE_FILE_MB: u64 = 5;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ChangeStatus {
    Added,
    Modified,
    Deleted,
    BaselineMissing,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangesetEntry {
    pub path: String,
    pub status: ChangeStatus,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewSession {
    pub id: String,
    pub started_at: String,
    pub entries: HashMap<String, ChangesetEntry>,
    pub total_baseline_bytes: u64,
}

impl ReviewSession {
    pub fn new(id: String) -> Self {
        Self {
            id,
            started_at: chrono::Utc::now().to_rfc3339(),
            entries: HashMap::new(),
            total_baseline_bytes: 0,
        }
    }
}

fn staging_root(vault_path: &Path) -> PathBuf {
    vault_path.join(STAGING_DIR)
}

fn session_dir(vault_path: &Path, session_id: &str) -> PathBuf {
    staging_root(vault_path).join(session_id)
}

fn baseline_dir(vault_path: &Path, session_id: &str) -> PathBuf {
    session_dir(vault_path, session_id).join("baseline")
}

fn baseline_path(vault_path: &Path, session_id: &str, rel: &str) -> PathBuf {
    baseline_dir(vault_path, session_id).join(rel.trim_start_matches('/'))
}

fn within_cap(session: &ReviewSession, new_bytes: u64) -> bool {
    session.total_baseline_bytes + new_bytes <= STAGING_CAP_MB * 1024 * 1024
}

fn is_large(size: u64) -> bool {
    size > LARGE_FILE_MB * 1024 * 1024
}

/// Ensure a baseline copy exists before a file is mutated by Wenmei or an agent.
/// Returns true if a baseline was (or already is) stored.
pub fn ensure_baseline(
    state: &State<'_, WenmeiState>,
    path: &str,
    status: ChangeStatus,
) -> Result<bool, String> {
    let vault = active_vault(state)?;
    let full_path = resolve_path(&vault, path)?;
    let meta = match fs::metadata(&full_path) {
        Ok(m) => m,
        Err(_) => {
            // File does not exist (e.g., a new file or already deleted).
            record_change(state, path, status, 0)?;
            return Ok(false);
        }
    };

    let size = meta.len();
    if meta.is_dir() {
        return Ok(false);
    }

    let mut current = state.review_session.lock().unwrap();
    let Some(session) = current.as_mut() else {
        return Ok(false);
    };

    if session.entries.contains_key(path) {
        // Already tracked; don't duplicate baseline.
        return Ok(true);
    }

    if is_large(size) {
        session.entries.insert(
            path.to_string(),
            ChangesetEntry {
                path: path.to_string(),
                status: ChangeStatus::BaselineMissing,
                size,
            },
        );
        return Ok(false);
    }

    if !within_cap(session, size) {
        session.entries.insert(
            path.to_string(),
            ChangesetEntry {
                path: path.to_string(),
                status: ChangeStatus::BaselineMissing,
                size,
            },
        );
        return Ok(false);
    }

    let baseline = baseline_path(Path::new(&vault.path), &session.id, path);
    if let Some(parent) = baseline.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(&full_path, &baseline).map_err(|e| e.to_string())?;
    session.total_baseline_bytes += size;
    session.entries.insert(
        path.to_string(),
        ChangesetEntry {
            path: path.to_string(),
            status,
            size,
        },
    );
    Ok(true)
}

fn record_change(
    state: &State<'_, WenmeiState>,
    path: &str,
    status: ChangeStatus,
    size: u64,
) -> Result<(), String> {
    let mut current = state.review_session.lock().unwrap();
    if let Some(session) = current.as_mut() {
        session.entries.insert(
            path.to_string(),
            ChangesetEntry {
                path: path.to_string(),
                status,
                size,
            },
        );
    }
    Ok(())
}

/// Called when polling detects an external change. Ensures a baseline if the file
/// still exists and the session hasn't already tracked it.
pub fn observe_external_change(
    state: &State<'_, WenmeiState>,
    path: &str,
) -> Result<Option<ChangesetEntry>, String> {
    let vault = active_vault(state)?;
    let full_path = resolve_path(&vault, path)?;

    let status = if full_path.exists() {
        if full_path.metadata().map(|m| m.len()).unwrap_or(0) == 0 &&
            !state.review_session.lock().unwrap().as_ref().map(|s| s.entries.contains_key(path)).unwrap_or(false)
        {
            // Heuristic: a zero-byte file that wasn't tracked before is likely new.
            ChangeStatus::Added
        } else {
            ChangeStatus::Modified
        }
    } else {
        ChangeStatus::Deleted
    };

    ensure_baseline(state, path, status.clone())?;

    let entry = state
        .review_session
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|s| s.entries.get(path).cloned());
    Ok(entry)
}

fn emit_changeset_updated(app: &AppHandle, entries: Vec<ChangesetEntry>) {
    let _ = app.emit("changeset-updated", entries);
}

#[tauri::command]
pub fn review_session_start(state: State<'_, WenmeiState>, app: AppHandle) -> Result<String, String> {
    let vault = active_vault(&state)?;
    let id = format!("rs-{}", chrono::Utc::now().timestamp_millis());

    let dir = session_dir(Path::new(&vault.path), &id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    {
        let mut current = state.review_session.lock().unwrap();
        *current = Some(ReviewSession::new(id.clone()));
    }

    append_journal_event(
        &state,
        KIND_REVIEW_SESSION_STARTED,
        "review-panel",
        None,
        format!("Review session {} started", id),
        serde_json::json!({"session_id": id}),
    )?;

    emit_changeset_updated(&app, vec![]);

    // Snapshot current .md files under a size cap to mitigate PTY pre-image race.
    let workspace = PathBuf::from(&vault.path);
    if let Ok(entries) = fs::read_dir(&workspace) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("md") && path.is_file() {
                let rel = relative_path(&path, &workspace);
                let _ = ensure_baseline(&state, &rel, ChangeStatus::Modified);
            }
        }
    }

    let _ = emit_files_changed(&app, KIND_REVIEW_SESSION_STARTED);
    Ok(id)
}

#[tauri::command]
pub fn review_session_close(
    state: State<'_, WenmeiState>,
    app: AppHandle,
    discard: bool,
) -> Result<(), String> {
    let session_id = {
        let mut current = state.review_session.lock().unwrap();
        current.take().map(|s| s.id)
    };

    if let Some(id) = session_id {
        if discard {
            let vault = active_vault(&state)?;
            let dir = session_dir(Path::new(&vault.path), &id);
            let _ = fs::remove_dir_all(&dir);
        }
        append_journal_event(
            &state,
            KIND_REVIEW_SESSION_CLOSED,
            "review-panel",
            None,
            format!("Review session {} closed", id),
            serde_json::json!({"session_id": id, "discard": discard}),
        )?;
    }

    emit_changeset_updated(&app, vec![]);
    let _ = emit_files_changed(&app, KIND_REVIEW_SESSION_CLOSED);
    Ok(())
}

#[tauri::command]
pub fn review_approve(
    state: State<'_, WenmeiState>,
    app: AppHandle,
    path: String,
) -> Result<(), String> {
    let (session_id, removed) = {
        let mut current = state.review_session.lock().unwrap();
        let Some(session) = current.as_mut() else {
            return Err("No active review session".to_string());
        };
        let removed = session.entries.remove(&path);
        (session.id.clone(), removed)
    };

    if let Some(entry) = removed {
        if entry.status != ChangeStatus::Deleted {
            let vault = active_vault(&state)?;
            let baseline = baseline_path(Path::new(&vault.path), &session_id, &path);
            if baseline.exists() {
                let _ = fs::remove_file(&baseline);
            }
        }
    }

    append_journal_event(
        &state,
        KIND_REVIEW_APPROVED,
        "review-panel",
        Some(path.clone()),
        format!("Approved {}", path),
        serde_json::json!({"session_id": session_id, "path": path}),
    )?;

    let entries: Vec<ChangesetEntry> = state
        .review_session
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| s.entries.values().cloned().collect())
        .unwrap_or_default();
    emit_changeset_updated(&app, entries);
    Ok(())
}

#[tauri::command]
pub fn review_reject(
    state: State<'_, WenmeiState>,
    app: AppHandle,
    path: String,
) -> Result<(), String> {
    let session_id = {
        let current = state.review_session.lock().unwrap();
        current
            .as_ref()
            .map(|s| s.id.clone())
            .ok_or_else(|| "No active review session".to_string())?
    };

    let vault = active_vault(&state)?;
    let baseline = baseline_path(Path::new(&vault.path), &session_id, &path);
    let full_path = resolve_path(&vault, &path)?;

    if baseline.exists() {
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(&baseline, &full_path).map_err(|e| e.to_string())?;
    }

    {
        let mut current = state.review_session.lock().unwrap();
        if let Some(session) = current.as_mut() {
            session.entries.remove(&path);
        }
    }

    append_journal_event(
        &state,
        KIND_REVIEW_REJECTED,
        "review-panel",
        Some(path.clone()),
        format!("Rejected {} and restored baseline", path),
        serde_json::json!({"session_id": session_id, "path": path}),
    )?;

    emit_files_changed(&app, "review.reject");

    let entries: Vec<ChangesetEntry> = state
        .review_session
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| s.entries.values().cloned().collect())
        .unwrap_or_default();
    emit_changeset_updated(&app, entries);
    Ok(())
}

#[tauri::command]
pub fn review_changeset(state: State<'_, WenmeiState>) -> Result<Vec<ChangesetEntry>, String> {
    let current = state.review_session.lock().unwrap();
    Ok(current
        .as_ref()
        .map(|s| s.entries.values().cloned().collect())
        .unwrap_or_default())
}
