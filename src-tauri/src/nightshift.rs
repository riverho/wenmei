use serde::{Deserialize, Serialize};
use std::fs;
use tauri::State;

use crate::journal::append_journal_event;
use crate::state::{active_terminal_context, WenmeiState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NightShiftRun {
    pub id: String,
    pub status: String,
    pub task_count: usize,
    pub tasks: Vec<String>,
    pub briefing_path: String,
    pub created_at: String,
}

fn run_file(state: &State<'_, WenmeiState>) -> Result<std::path::PathBuf, String> {
    let ctx = active_terminal_context(state)?;
    let dir = ctx.meta_root.join("nightshift");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("last-run.json"))
}

fn parse_tasks(raw: &str) -> Vec<String> {
    raw.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !line.starts_with('#'))
        .map(|line| line.trim_start_matches("- [ ]").trim().to_string())
        .filter(|line| !line.is_empty())
        .collect()
}

#[tauri::command]
pub fn night_shift_start(state: State<'_, WenmeiState>) -> Result<NightShiftRun, String> {
    let ctx = active_terminal_context(&state)?;
    let todo_path = ctx.cwd.join("TODO.md");
    let raw = fs::read_to_string(&todo_path).map_err(|e| e.to_string())?;
    let tasks = parse_tasks(&raw);
    let run = NightShiftRun {
        id: format!("night-{}", chrono::Utc::now().timestamp_millis()),
        status: "waiting_for_review".to_string(),
        task_count: tasks.len(),
        tasks,
        briefing_path: ctx
            .meta_root
            .join("nightshift")
            .join("last-run.json")
            .to_string_lossy()
            .to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    let path = run_file(&state)?;
    fs::write(
        &path,
        serde_json::to_string_pretty(&run).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let _ = append_journal_event(
        &state,
        "nightshift.started",
        "nightshift",
        Some("TODO.md".to_string()),
        format!("Night shift staged {} task(s); no auto-commit", run.task_count),
        serde_json::json!({"run_id": run.id, "task_count": run.task_count}),
    );
    Ok(run)
}

#[tauri::command]
pub fn night_shift_status(state: State<'_, WenmeiState>) -> Result<Option<NightShiftRun>, String> {
    let path = run_file(&state)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map(Some).map_err(|e| e.to_string())
}
