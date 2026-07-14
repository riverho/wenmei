use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};

use crate::state::{active_terminal_context, TerminalContext, WenmeiState};
use tauri::Manager;

// Event kinds written by the review surface (docs/design/changeset-review.md).
pub const KIND_REVIEW_SESSION_STARTED: &str = "review.session_started";
pub const KIND_REVIEW_SESSION_CLOSED: &str = "review.session_closed";
pub const KIND_REVIEW_APPROVED: &str = "review.approved";
pub const KIND_REVIEW_REJECTED: &str = "review.rejected";

// Notification kinds surfaced as alerts in the unified sidecar feed
// (docs/design/unified-sidecar.md). Journaled as `notification.<kind>`.
// Active emitters: review.rs, polling.rs (NOTIFY_REVIEW_CHANGES),
// narration.rs (NOTIFY_NARRATION_RISKY), terminal.rs (NOTIFY_TERMINAL_DONE),
// nightshift.rs (NOTIFY_NIGHTSHIFT_DONE), heartbeat.rs (NOTIFY_AGENT_DONE).
pub const NOTIFY_REVIEW_CHANGES: &str = "review.changes";
pub const NOTIFY_NARRATION_RISKY: &str = "narration.risky";
pub const NOTIFY_TERMINAL_DONE: &str = "terminal.done";
pub const NOTIFY_NIGHTSHIFT_DONE: &str = "nightshift.done";
pub const NOTIFY_AGENT_DONE: &str = "agent.task_done";

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

#[derive(Debug, Clone, Serialize)]
pub struct WenmeiNotification {
    pub kind: String,
    pub title: String,
    pub body: String,
    pub session_id: Option<String>,
    pub ts: String,
}

/// Identical (kind, session, title) within this window collapses (no re-emit),
/// so a stuck terminal or a chatty agent doesn't spam alerts.
const NOTIFY_DEDUP_SECS: u64 = 60;

fn notify_dedup_map() -> &'static Mutex<HashMap<String, Instant>> {
    static MAP: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Emit an alert into the unified sidecar feed: journals `notification.<kind>`,
/// emits `wenmei-notification` to the frontend, and raises an OS notification
/// when the main window is unfocused. Best-effort — never fails the caller.
pub fn emit_notification(
    app: &AppHandle,
    kind: &str,
    title: &str,
    body: &str,
    session_id: Option<String>,
) {
    let dedup_key = format!("{kind}|{}|{title}", session_id.as_deref().unwrap_or(""));
    {
        let mut map = notify_dedup_map().lock().unwrap();
        let now = Instant::now();
        map.retain(|_, at| now.duration_since(*at).as_secs() < NOTIFY_DEDUP_SECS);
        if map.contains_key(&dedup_key) {
            return;
        }
        map.insert(dedup_key, now);
    }

    let note = WenmeiNotification {
        kind: kind.to_string(),
        title: title.to_string(),
        body: body.to_string(),
        session_id: session_id.clone(),
        ts: chrono::Utc::now().to_rfc3339(),
    };
    let _ = app.emit("wenmei-notification", &note);

    if let Some(state) = app.try_state::<WenmeiState>() {
        let _ = append_journal_event(
            &state,
            &format!("notification.{kind}"),
            "notifier",
            None,
            format!("{title} — {body}"),
            serde_json::json!({ "session_id": session_id }),
        );
    }

    let focused = app
        .get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(true);
    if !focused {
        use tauri_plugin_notification::NotificationExt;
        let _ = app.notification().builder().title(title).body(body).show();
    }
}

fn journal_path(ctx: &TerminalContext) -> PathBuf {
    ctx.meta_root.join("journal.jsonl")
}

/// Cap the live journal's on-disk size. Rotates (renames) rather than
/// truncates — same "never destroy, only move" rule this app already
/// applies to file deletes (`.wenmei/trash/`) — so `list_journal_events`
/// and `audit.export` only ever see the live file, but nothing is lost;
/// older history is still on disk under `journal-archive/` if needed.
const JOURNAL_ROTATE_BYTES: u64 = 10 * 1024 * 1024;

fn rotate_journal_if_needed(path: &PathBuf) {
    let Ok(meta) = fs::metadata(path) else {
        return;
    };
    if meta.len() < JOURNAL_ROTATE_BYTES {
        return;
    }
    let Some(parent) = path.parent() else {
        return;
    };
    let archive_dir = parent.join("journal-archive");
    if fs::create_dir_all(&archive_dir).is_err() {
        return;
    }
    let archived = archive_dir.join(format!(
        "journal-{}.jsonl",
        chrono::Utc::now().format("%Y%m%dT%H%M%S%.f")
    ));
    let _ = fs::rename(path, archived);
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
    rotate_journal_if_needed(&path);
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
    // Annotate the focused terminal's narration buffer with the change.
    if let Some(state) = app.try_state::<WenmeiState>() {
        let active = state.active_terminal_id.lock().ok().and_then(|g| g.clone());
        if let Some(id) = active {
            if let Ok(terminals) = state.terminals.lock() {
                if let Some(session) = terminals.get(&id) {
                    if let Ok(mut nb) = session.narration_buffer.lock() {
                        nb.annotate_file_changes(vec![reason.to_string()]);
                    }
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
