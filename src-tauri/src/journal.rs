use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};

use crate::state::{active_terminal_context, TerminalContext, WenmeiState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalEvent {
    pub ts: String,
    pub vault_id: String,
    pub sandbox_id: String,
    pub kind: String,
    pub source: String,
    pub path: Option<String>,
    pub summary: String,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct SandboxFilesChanged {
    pub reason: String,
}

fn journal_path(ctx: &TerminalContext) -> PathBuf {
    ctx.meta_root.join("journal.jsonl")
}

pub fn append_journal_event(
    state: &State<'_, WenmeiState>,
    kind: &str,
    source: &str,
    path: Option<String>,
    summary: String,
    metadata: serde_json::Value,
) -> Result<(), String> {
    let app_state = state.app_state.lock().unwrap();
    let vault_id = app_state.active_vault_id.clone();
    let sandbox_id = app_state
        .active_sandbox_id
        .clone()
        .unwrap_or_else(|| format!("{}-root", vault_id));
    drop(app_state);
    let ctx = active_terminal_context(state)?;
    let event = JournalEvent {
        ts: chrono::Utc::now().to_rfc3339(),
        vault_id,
        sandbox_id,
        kind: kind.to_string(),
        source: source.to_string(),
        path,
        summary,
        metadata,
    };
    let path = journal_path(&ctx);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut raw = serde_json::to_string(&event).map_err(|e| e.to_string())?;
    raw.push('\n');
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(raw.as_bytes()).map_err(|e| e.to_string())
}

pub fn emit_files_changed(app: &AppHandle, reason: &str) {
    let _ = app.emit(
        "sandbox-files-changed",
        SandboxFilesChanged {
            reason: reason.to_string(),
        },
    );
}

#[tauri::command]
pub fn append_journal(
    kind: String,
    source: String,
    path: Option<String>,
    summary: String,
    metadata: Option<serde_json::Value>,
    state: State<'_, WenmeiState>,
) -> Result<(), String> {
    append_journal_event(
        &state,
        &kind,
        &source,
        path,
        summary,
        metadata.unwrap_or_else(|| serde_json::json!({})),
    )
}

#[tauri::command]
pub fn list_journal_events(
    limit: Option<usize>,
    state: State<'_, WenmeiState>,
) -> Result<Vec<JournalEvent>, String> {
    let ctx = active_terminal_context(&state)?;
    let raw = fs::read_to_string(journal_path(&ctx)).unwrap_or_default();
    let mut events: Vec<JournalEvent> = raw
        .lines()
        .filter_map(|line| serde_json::from_str::<JournalEvent>(line).ok())
        .collect();
    events.reverse();
    events.truncate(limit.unwrap_or(50));
    Ok(events)
}
