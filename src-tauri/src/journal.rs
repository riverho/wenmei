use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};

use crate::state::{active_terminal_context, TerminalContext, WenmeiState};
use tauri::Manager;

// Event kinds written by the review surface (docs/design/changeset-review.md).
pub const KIND_REVIEW_SESSION_STARTED: &str = "review.session_started";
pub const KIND_REVIEW_SESSION_CLOSED: &str = "review.session_closed";
pub const KIND_REVIEW_APPROVED: &str = "review.approved";
pub const KIND_REVIEW_REJECTED: &str = "review.rejected";

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

#[derive(Debug, Clone, Serialize)]
pub struct AuditExport {
    pub json_path: String,
    pub markdown_path: String,
    pub event_count: usize,
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
    if let Some(state) = app.try_state::<WenmeiState>() {
        if let Ok(current) = state.terminal.lock() {
            if let Some(session) = current.as_ref() {
                if let Ok(mut nb) = session.narration_buffer.lock() {
                    nb.annotate_file_changes(vec![reason.to_string()]);
                }
            }
        }
    }
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

pub fn build_briefing_from_events(events: &[JournalEvent]) -> String {
    let mut out = String::from("# BRIEFING\n\nRecent sandbox context for the next agent session.\n\n");
    if events.is_empty() {
        out.push_str("- No journal events yet.\n");
        return out;
    }

    for event in events.iter().take(20) {
        let path = event
            .path
            .as_ref()
            .map(|path| format!(" `{}`", path))
            .unwrap_or_default();
        out.push_str(&format!(
            "- {} [{}]{}: {}\n",
            event.ts, event.kind, path, event.summary
        ));
    }
    out
}

#[tauri::command]
pub fn build_briefing(
    limit: Option<usize>,
    state: State<'_, WenmeiState>,
) -> Result<String, String> {
    let events = list_journal_events(limit.or(Some(20)), state)?;
    Ok(build_briefing_from_events(&events))
}

#[tauri::command]
pub fn export_audit(state: State<'_, WenmeiState>) -> Result<AuditExport, String> {
    let ctx = active_terminal_context(&state)?;
    let raw = fs::read_to_string(journal_path(&ctx)).unwrap_or_default();
    let events: Vec<JournalEvent> = raw
        .lines()
        .filter_map(|line| serde_json::from_str::<JournalEvent>(line).ok())
        .collect();
    let audit_dir = ctx.meta_root.join("audit");
    fs::create_dir_all(&audit_dir).map_err(|e| e.to_string())?;
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let json_path = audit_dir.join(format!("audit-{}.json", stamp));
    let markdown_path = audit_dir.join(format!("audit-{}.md", stamp));
    fs::write(
        &json_path,
        serde_json::to_string_pretty(&events).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let mut markdown = String::from("# Wenmei Audit Export\n\n");
    for event in &events {
        markdown.push_str(&format!(
            "- {} `{}` [{}] {}\n",
            event.ts, event.kind, event.source, event.summary
        ));
    }
    fs::write(&markdown_path, markdown).map_err(|e| e.to_string())?;

    Ok(AuditExport {
        json_path: json_path.to_string_lossy().to_string(),
        markdown_path: markdown_path.to_string_lossy().to_string(),
        event_count: events.len(),
    })
}
