use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter, State};
use walkdir::WalkDir;

use crate::file_ops::resolve_path;
use crate::journal::{
    append_journal_event, emit_files_changed, emit_notification, KIND_REVIEW_APPROVED,
    KIND_REVIEW_REJECTED, KIND_REVIEW_SESSION_CLOSED, KIND_REVIEW_SESSION_STARTED,
    NOTIFY_REVIEW_CHANGES,
};
use crate::state::{active_vault, relative_path, WenmeiState};

const STAGING_DIR: &str = ".wenmei/staging";
const REVIEW_LEDGER_FILE: &str = "review.jsonl";
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
pub struct ReviewLedger {
    pub ts: String,
    pub session_id: String,
    pub event: String,
    pub path: Option<String>,
    pub status: Option<ChangeStatus>,
    pub baseline_hash: Option<String>,
    pub current_hash: Option<String>,
    pub size: u64,
    pub restore_available: bool,
    pub reviewer: String,
    pub risk_level: Option<String>,
    pub proposed_decision: Option<String>,
    pub final_decision: Option<String>,
    pub annotation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewSession {
    pub id: String,
    pub started_at: String,
    pub entries: HashMap<String, ChangesetEntry>,
    pub known_paths: HashSet<String>,
    pub total_baseline_bytes: u64,
    /// If true, the vault is a git repo and we use HEAD as the immutable
    /// baseline instead of copying files into .wenmei/staging.
    pub git_backed: bool,
}

impl ReviewSession {
    pub fn new(id: String, git_backed: bool) -> Self {
        Self {
            id,
            started_at: chrono::Utc::now().to_rfc3339(),
            entries: HashMap::new(),
            known_paths: HashSet::new(),
            total_baseline_bytes: 0,
            git_backed,
        }
    }
}

fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn is_git_repo(vault_path: &Path) -> bool {
    vault_path.join(".git").is_dir() && git_available()
}

/// Restore a file from git HEAD. The path must be vault-relative (leading `/`
/// is stripped). Returns an error if git is unavailable or the path is not
/// tracked in HEAD.
fn git_restore_from_head(vault_path: &Path, rel: &str) -> Result<(), String> {
    let rel = rel.trim_start_matches('/');
    let output = Command::new("git")
        .args(["checkout", "HEAD", "--", rel])
        .current_dir(vault_path)
        .output()
        .map_err(|e| format!("git restore failed: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git checkout failed: {}", stderr));
    }
    Ok(())
}

/// Read the HEAD version of a file into memory. Returns None if the file is
/// not tracked in HEAD (e.g., an added-but-not-committed file).
fn git_read_head(vault_path: &Path, rel: &str) -> Result<Option<Vec<u8>>, String> {
    let rel = rel.trim_start_matches('/');
    let output = Command::new("git")
        .args(["show", &format!("HEAD:{}", rel)])
        .current_dir(vault_path)
        .output()
        .map_err(|e| format!("git show failed: {}", e))?;
    if output.status.success() {
        Ok(Some(output.stdout))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("Path '") && stderr.contains("' does not exist") {
            Ok(None)
        } else {
            Err(format!("git show failed: {}", stderr))
        }
    }
}

fn git_file_hash(vault_path: &Path, rel: &str) -> Option<String> {
    git_read_head(vault_path, rel)
        .ok()
        .flatten()
        .map(|bytes| {
            let mut hash: u64 = 0xcbf29ce484222325;
            for byte in bytes {
                hash ^= byte as u64;
                hash = hash.wrapping_mul(0x100000001b3);
            }
            format!("fnv1a64:{:016x}", hash)
        })
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

fn review_ledger_path(vault_path: &Path, session_id: &str) -> PathBuf {
    session_dir(vault_path, session_id).join(REVIEW_LEDGER_FILE)
}

/// Lightweight walk that records which files exist at session start without
/// copying their contents. Existing files that later change are classified as
/// Modified; new files are Added. This replaces the eager full-tree snapshot.
fn initialize_known_paths(vault_path: &Path, session: &mut ReviewSession) {
    for entry in WalkDir::new(vault_path)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            entry.depth() == 0 || (!name.starts_with('.') && name != ".wenmei")
        })
        .filter_map(|entry| entry.ok())
    {
        if entry.file_type().is_file() {
            let rel = relative_path(entry.path(), vault_path);
            session.known_paths.insert(rel);
        }
    }
}

fn within_cap(session: &ReviewSession, new_bytes: u64) -> bool {
    session.total_baseline_bytes + new_bytes <= STAGING_CAP_MB * 1024 * 1024
}

fn is_large(size: u64) -> bool {
    size > LARGE_FILE_MB * 1024 * 1024
}

fn file_hash(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut hash: u64 = 0xcbf29ce484222325;
    let mut buf = [0u8; 8192];
    loop {
        let read = file.read(&mut buf).ok()?;
        if read == 0 {
            break;
        }
        for byte in &buf[..read] {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    Some(format!("fnv1a64:{:016x}", hash))
}

fn restore_available(
    status: &ChangeStatus,
    baseline: &Path,
    git_backed: bool,
    vault_path: &Path,
    rel: &str,
) -> bool {
    match status {
        ChangeStatus::Added => true,
        ChangeStatus::Modified | ChangeStatus::Deleted => {
            if git_backed {
                git_read_head(vault_path, rel).map(|v| v.is_some()).unwrap_or(false)
            } else {
                baseline.exists()
            }
        }
        ChangeStatus::BaselineMissing => false,
    }
}

fn append_review_ledger(vault_path: &Path, entry: ReviewLedger) -> Result<(), String> {
    let path = review_ledger_path(vault_path, &entry.session_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut raw = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
    raw.push('\n');
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(raw.as_bytes()).map_err(|e| e.to_string())
}

#[allow(clippy::too_many_arguments)]
fn append_file_review_ledger(
    vault_path: &Path,
    session_id: &str,
    event: &str,
    path: &str,
    status: ChangeStatus,
    size: u64,
    reviewer: &str,
    risk_level: Option<String>,
    proposed_decision: Option<String>,
    final_decision: Option<String>,
    annotation: Option<String>,
) -> Result<(), String> {
    let git_backed = is_git_repo(vault_path);
    let baseline = baseline_path(vault_path, session_id, path);
    let current = vault_path.join(path.trim_start_matches('/'));
    let baseline_hash = if git_backed {
        git_file_hash(vault_path, path)
    } else {
        file_hash(&baseline)
    };
    append_review_ledger(
        vault_path,
        ReviewLedger {
            ts: chrono::Utc::now().to_rfc3339(),
            session_id: session_id.to_string(),
            event: event.to_string(),
            path: Some(path.to_string()),
            status: Some(status.clone()),
            baseline_hash,
            current_hash: file_hash(&current),
            size,
            restore_available: restore_available(&status, &baseline, git_backed, vault_path, path),
            reviewer: reviewer.to_string(),
            risk_level,
            proposed_decision,
            final_decision,
            annotation,
        },
    )
}

fn append_session_review_ledger(
    vault_path: &Path,
    session_id: &str,
    event: &str,
    reviewer: &str,
    annotation: Option<String>,
) -> Result<(), String> {
    append_review_ledger(
        vault_path,
        ReviewLedger {
            ts: chrono::Utc::now().to_rfc3339(),
            session_id: session_id.to_string(),
            event: event.to_string(),
            path: None,
            status: None,
            baseline_hash: None,
            current_hash: None,
            size: 0,
            restore_available: false,
            reviewer: reviewer.to_string(),
            risk_level: None,
            proposed_decision: None,
            final_decision: None,
            annotation,
        },
    )
}

fn copy_baseline(
    vault_path: &Path,
    session: &mut ReviewSession,
    rel: &str,
    full_path: &Path,
    size: u64,
) -> Result<bool, String> {
    if is_large(size) || !within_cap(session, size) {
        return Ok(false);
    }

    let baseline = baseline_path(vault_path, &session.id, rel);
    if baseline.exists() {
        return Ok(true);
    }

    if let Some(parent) = baseline.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(full_path, &baseline).map_err(|e| e.to_string())?;
    session.total_baseline_bytes += size;
    Ok(true)
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
        // Already tracked; don't duplicate baseline or ledger entries.
        if session.git_backed {
            return Ok(true);
        }
        let baseline = baseline_path(Path::new(&vault.path), &session.id, path);
        return Ok(baseline.exists());
    }

    // For git-backed vaults, HEAD is the immutable baseline. No copy needed.
    if session.git_backed {
        let session_id = session.id.clone();
        session.entries.insert(
            path.to_string(),
            ChangesetEntry {
                path: path.to_string(),
                status: status.clone(),
                size,
            },
        );
        session.known_paths.insert(path.to_string());
        let _ = append_file_review_ledger(
            Path::new(&vault.path),
            &session_id,
            "change_observed",
            path,
            status,
            size,
            "system",
            None,
            None,
            None,
            None,
        );
        return Ok(true);
    }

    let baseline = baseline_path(Path::new(&vault.path), &session.id, path);
    if baseline.exists() {
        if file_hash(&baseline).is_some() && file_hash(&baseline) == file_hash(&full_path) {
            session.entries.remove(path);
            session.known_paths.insert(path.to_string());
            return Ok(true);
        }
        let session_id = session.id.clone();
        session.entries.insert(
            path.to_string(),
            ChangesetEntry {
                path: path.to_string(),
                status: status.clone(),
                size,
            },
        );
        session.known_paths.insert(path.to_string());
        let _ = append_file_review_ledger(
            Path::new(&vault.path),
            &session_id,
            "change_observed",
            path,
            status,
            size,
            "system",
            None,
            None,
            None,
            None,
        );
        return Ok(true);
    }

    if status == ChangeStatus::Added {
        let session_id = session.id.clone();
        session.entries.insert(
            path.to_string(),
            ChangesetEntry {
                path: path.to_string(),
                status: status.clone(),
                size,
            },
        );
        let _ = append_file_review_ledger(
            Path::new(&vault.path),
            &session_id,
            "change_observed",
            path,
            status,
            size,
            "system",
            None,
            None,
            None,
            None,
        );
        return Ok(false);
    }

    if session.known_paths.contains(path) && (is_large(size) || !within_cap(session, size)) {
        let session_id = session.id.clone();
        session.entries.insert(
            path.to_string(),
            ChangesetEntry {
                path: path.to_string(),
                status: ChangeStatus::BaselineMissing,
                size,
            },
        );
        let _ = append_file_review_ledger(
            Path::new(&vault.path),
            &session_id,
            "change_observed",
            path,
            ChangeStatus::BaselineMissing,
            size,
            "system",
            None,
            None,
            None,
            None,
        );
        return Ok(false);
    }

    let stored = copy_baseline(Path::new(&vault.path), session, path, &full_path, size)?;
    let session_id = session.id.clone();
    let ledger_status = if stored {
        status.clone()
    } else {
        ChangeStatus::BaselineMissing
    };
    session.entries.insert(
        path.to_string(),
        ChangesetEntry {
            path: path.to_string(),
            status: ledger_status.clone(),
            size,
        },
    );
    session.known_paths.insert(path.to_string());
    let _ = append_file_review_ledger(
        Path::new(&vault.path),
        &session_id,
        "change_observed",
        path,
        ledger_status,
        size,
        "system",
        None,
        None,
        None,
        None,
    );
    Ok(stored)
}

fn record_change(
    state: &State<'_, WenmeiState>,
    path: &str,
    status: ChangeStatus,
    size: u64,
) -> Result<(), String> {
    let mut current = state.review_session.lock().unwrap();
    if let Some(session) = current.as_mut() {
        // Idempotent: polling may observe the same missing/deleted file many
        // times. Only the first observation becomes a ledger event.
        if session.entries.contains_key(path) {
            return Ok(());
        }
        let vault = active_vault(state)?;
        let session_id = session.id.clone();
        session.entries.insert(
            path.to_string(),
            ChangesetEntry {
                path: path.to_string(),
                status: status.clone(),
                size,
            },
        );
        let _ = append_file_review_ledger(
            Path::new(&vault.path),
            &session_id,
            "change_observed",
            path,
            status,
            size,
            "system",
            None,
            None,
            None,
            None,
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
    let known = state
        .review_session
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| s.known_paths.contains(path))
        .unwrap_or(false);

    let status = if full_path.exists() {
        if known {
            ChangeStatus::Modified
        } else {
            ChangeStatus::Added
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
    if !entries.is_empty() {
        emit_notification(
            app,
            NOTIFY_REVIEW_CHANGES,
            "Review changeset updated",
            &format!("{} file(s) awaiting review", entries.len()),
            None,
        );
    }
    let _ = app.emit("changeset-updated", entries);
}

#[tauri::command]
pub fn review_session_start(state: State<'_, WenmeiState>, app: AppHandle) -> Result<String, String> {
    let vault = active_vault(&state)?;
    let id = format!("rs-{}", chrono::Utc::now().timestamp_millis());
    let git_backed = is_git_repo(Path::new(&vault.path));

    let dir = session_dir(Path::new(&vault.path), &id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    {
        let mut current = state.review_session.lock().unwrap();
        let mut session = ReviewSession::new(id.clone(), git_backed);
        initialize_known_paths(Path::new(&vault.path), &mut session);
        *current = Some(session);
    }

    append_journal_event(
        &state,
        KIND_REVIEW_SESSION_STARTED,
        "review-panel",
        None,
        format!("Review session {} started", id),
        serde_json::json!({"session_id": id, "git_backed": git_backed}),
    )?;
    append_session_review_ledger(
        Path::new(&vault.path),
        &id,
        "session_started",
        "system",
        Some(format!(
            "Review session started (git-backed: {})",
            git_backed
        )),
    )?;

    emit_changeset_updated(&app, vec![]);

    // Baselines are captured lazily when a file is actually mutated, not at
    // session start. known_paths was populated above so existing files that
    // change are reported as Modified rather than Added.
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
        let vault = active_vault(&state)?;
        let _ = append_session_review_ledger(
            Path::new(&vault.path),
            &id,
            "session_closed",
            "system",
            Some(format!("Review session closed; discard={}", discard)),
        );
    }

    emit_changeset_updated(&app, vec![]);
    let _ = emit_files_changed(&app, KIND_REVIEW_SESSION_CLOSED);
    Ok(())
}

#[tauri::command]
pub fn clear_review_staging(state: State<'_, WenmeiState>) -> Result<(), String> {
    let vault = active_vault(&state)?;
    let staging = staging_root(Path::new(&vault.path));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
    }
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
        let vault = active_vault(&state)?;
        let git_backed = {
            let current = state.review_session.lock().unwrap();
            current.as_ref().map(|s| s.git_backed).unwrap_or(false)
        };

        if git_backed {
            // HEAD is the immutable baseline; no staging copy to manage.
            let _ = append_file_review_ledger(
                Path::new(&vault.path),
                &session_id,
                "decision",
                &path,
                entry.status,
                entry.size,
                "human",
                None,
                None,
                Some("approved".to_string()),
                Some("Approved from ReviewPanel".to_string()),
            );
        } else {
            let baseline = baseline_path(Path::new(&vault.path), &session_id, &path);
            if baseline.exists() {
                let _ = fs::remove_file(&baseline);
            }
            let full_path = resolve_path(&vault, &path)?;
            if full_path.is_file() {
                let size = full_path.metadata().map(|m| m.len()).unwrap_or(0);
                let mut current = state.review_session.lock().unwrap();
                if let Some(session) = current.as_mut() {
                    let _ = copy_baseline(
                        Path::new(&vault.path),
                        session,
                        &path,
                        &full_path,
                        size,
                    )?;
                    session.known_paths.insert(path.clone());
                }
            } else {
                let mut current = state.review_session.lock().unwrap();
                if let Some(session) = current.as_mut() {
                    session.known_paths.remove(&path);
                }
            }
            let _ = append_file_review_ledger(
                Path::new(&vault.path),
                &session_id,
                "decision",
                &path,
                entry.status,
                entry.size,
                "human",
                None,
                None,
                Some("approved".to_string()),
                Some("Approved from ReviewPanel".to_string()),
            );
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
    let (session_id, entry) = {
        let current = state.review_session.lock().unwrap();
        let session = current
            .as_ref()
            .ok_or_else(|| "No active review session".to_string())?;
        let entry = session
            .entries
            .get(&path)
            .cloned()
            .ok_or_else(|| "Path is not in the active changeset".to_string())?;
        (session.id.clone(), entry)
    };

    let vault = active_vault(&state)?;
    let git_backed = {
        let current = state.review_session.lock().unwrap();
        current.as_ref().map(|s| s.git_backed).unwrap_or(false)
    };
    let baseline = baseline_path(Path::new(&vault.path), &session_id, &path);
    let full_path = resolve_path(&vault, &path)?;

    match entry.status.clone() {
        ChangeStatus::Added => {
            if full_path.is_file() {
                fs::remove_file(&full_path).map_err(|e| e.to_string())?;
            }
        }
        ChangeStatus::Modified | ChangeStatus::Deleted => {
            if git_backed {
                git_restore_from_head(Path::new(&vault.path), &path)?;
            } else {
                if !baseline.exists() {
                    return Err(format!("No baseline available for {}", path));
                }
                if let Some(parent) = full_path.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                fs::copy(&baseline, &full_path).map_err(|e| e.to_string())?;
            }
        }
        ChangeStatus::BaselineMissing => {
            return Err(format!("No baseline available for {}", path));
        }
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
    let _ = append_file_review_ledger(
        Path::new(&vault.path),
        &session_id,
        "decision",
        &path,
        entry.status,
        entry.size,
        "human",
        None,
        None,
        Some("rejected".to_string()),
        Some("Rejected from ReviewPanel and restored baseline".to_string()),
    );

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

#[tauri::command]
pub fn review_annotate(
    state: State<'_, WenmeiState>,
    path: String,
    reviewer: String,
    risk_level: Option<String>,
    proposed_decision: Option<String>,
    annotation: String,
) -> Result<(), String> {
    let (session_id, entry) = {
        let current = state.review_session.lock().unwrap();
        let session = current
            .as_ref()
            .ok_or_else(|| "No active review session".to_string())?;
        let entry = session
            .entries
            .get(&path)
            .cloned()
            .ok_or_else(|| "Path is not in the active changeset".to_string())?;
        (session.id.clone(), entry)
    };
    let vault = active_vault(&state)?;
    append_file_review_ledger(
        Path::new(&vault.path),
        &session_id,
        "annotation",
        &path,
        entry.status,
        entry.size,
        &reviewer,
        risk_level,
        proposed_decision,
        None,
        Some(annotation),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "wenmei-review-test-{}-{}",
            name,
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn review_ledger_records_hashes_and_restore_capability() {
        let vault = unique_temp_dir("ledger");
        let session_id = "rs-test";
        let rel = "docs/nested.txt";
        let current = vault.join(rel);
        let baseline = baseline_path(&vault, session_id, rel);
        fs::create_dir_all(current.parent().unwrap()).unwrap();
        fs::create_dir_all(baseline.parent().unwrap()).unwrap();
        fs::write(&baseline, "original nested content\n").unwrap();
        fs::write(&current, "changed nested content\n").unwrap();

        append_session_review_ledger(
            &vault,
            session_id,
            "session_started",
            "system",
            Some("Review session started".to_string()),
        )
        .unwrap();
        append_file_review_ledger(
            &vault,
            session_id,
            "change_observed",
            rel,
            ChangeStatus::Modified,
            fs::metadata(&current).unwrap().len(),
            "system",
            None,
            None,
            None,
            None,
        )
        .unwrap();
        append_file_review_ledger(
            &vault,
            session_id,
            "annotation",
            rel,
            ChangeStatus::Modified,
            fs::metadata(&current).unwrap().len(),
            "pi",
            Some("low".to_string()),
            Some("approve".to_string()),
            None,
            Some("Only content changed in nested file".to_string()),
        )
        .unwrap();
        append_file_review_ledger(
            &vault,
            session_id,
            "decision",
            rel,
            ChangeStatus::Modified,
            fs::metadata(&current).unwrap().len(),
            "human",
            None,
            None,
            Some("rejected".to_string()),
            Some("Rejected from ReviewPanel and restored baseline".to_string()),
        )
        .unwrap();

        let raw = fs::read_to_string(review_ledger_path(&vault, session_id)).unwrap();
        let rows: Vec<ReviewLedger> = raw
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();

        assert_eq!(rows.len(), 4);
        assert_eq!(rows[0].event, "session_started");
        assert_eq!(rows[1].event, "change_observed");
        assert_eq!(rows[1].path.as_deref(), Some(rel));
        assert_eq!(rows[1].status, Some(ChangeStatus::Modified));
        assert!(rows[1].restore_available);
        assert!(rows[1].baseline_hash.is_some());
        assert!(rows[1].current_hash.is_some());
        assert_ne!(rows[1].baseline_hash, rows[1].current_hash);
        assert_eq!(rows[2].reviewer, "pi");
        assert_eq!(rows[2].risk_level.as_deref(), Some("low"));
        assert_eq!(rows[2].proposed_decision.as_deref(), Some("approve"));
        assert_eq!(rows[3].final_decision.as_deref(), Some("rejected"));

        let _ = fs::remove_dir_all(vault);
    }

    #[test]
    fn initialize_known_paths_does_not_copy_baselines() {
        let vault = unique_temp_dir("lazy");
        fs::write(vault.join("a.txt"), "a").unwrap();
        fs::write(vault.join("b.txt"), "b").unwrap();

        let mut session = ReviewSession::new("rs-lazy".to_string(), false);
        initialize_known_paths(&vault, &mut session);

        assert!(session.known_paths.contains("a.txt"));
        assert!(session.known_paths.contains("b.txt"));
        assert!(session.total_baseline_bytes == 0);

        let baseline_dir = baseline_dir(&vault, &session.id);
        assert!(!baseline_dir.exists() || baseline_dir.read_dir().unwrap().next().is_none());

        let _ = fs::remove_dir_all(vault);
    }

    #[test]
    fn copy_baseline_captures_single_file_on_demand() {
        let vault = unique_temp_dir("ondemand");
        fs::write(vault.join("x.txt"), "original").unwrap();

        let mut session = ReviewSession::new("rs-ondemand".to_string(), false);
        initialize_known_paths(&vault, &mut session);
        let full = vault.join("x.txt");
        let size = fs::metadata(&full).unwrap().len();

        let copied = copy_baseline(&vault, &mut session, "x.txt", &full, size).unwrap();
        assert!(copied);
        assert!(baseline_path(&vault, &session.id, "x.txt").exists());
        assert!(session.total_baseline_bytes == size);

        // Second call is idempotent.
        let copied2 = copy_baseline(&vault, &mut session, "x.txt", &full, size).unwrap();
        assert!(copied2);
        assert!(session.total_baseline_bytes == size);

        let _ = fs::remove_dir_all(vault);
    }
}
