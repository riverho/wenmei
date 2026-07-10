use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

use crate::journal::{append_journal_event, emit_notification};
use crate::state::{active_vault, WenmeiState};

// Heartbeat — the native tick engine (docs/design/sentinel-ledger.md §4).
// Run cards persist per project; the scheduler wakes them, watches for
// overdue/stuck, and speaks only through emit_notification. The heartbeat
// never executes work itself — dispatch belongs to the orchestrator (H11).

const RUNS_DIR: &str = ".wenmei/runs";
const TICK_MS: u64 = 5_000;
/// A running card with no progress for wake_secs * OVERDUE_FACTOR is stuck.
const OVERDUE_FACTOR: u64 = 3;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Idle,
    Running,
    WaitingInput,
    Stuck,
    Done,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum WakePolicy {
    Interval { secs: u64 },
    OnEvent { event: String },
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum StopCondition {
    /// Shell command, cwd = project root, exit 0 = done.
    ChecksPass { command: String },
    /// Only a human record closes the run.
    HumanGate,
    /// Pause when the metered token budget is exhausted.
    Budget { tokens: u64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunCard {
    pub id: String,
    pub goal: String,
    pub wake: WakePolicy,
    pub stop: StopCondition,
    pub status: RunStatus,
    pub created_at: String,
    /// Epoch seconds of the last observed progress (tick/touch).
    #[serde(default)]
    pub last_progress_epoch: i64,
    /// Set once per stuck episode so the alert doesn't repeat every tick.
    #[serde(default)]
    pub overdue_notified: bool,
}

fn now_epoch() -> i64 {
    chrono::Utc::now().timestamp()
}

fn runs_dir(vault_path: &str) -> PathBuf {
    PathBuf::from(vault_path).join(RUNS_DIR)
}

fn card_path(vault_path: &str, id: &str) -> PathBuf {
    runs_dir(vault_path).join(format!("{id}.json"))
}

fn load_cards(vault_path: &str) -> Vec<RunCard> {
    let dir = runs_dir(vault_path);
    let Ok(entries) = fs::read_dir(&dir) else {
        return vec![];
    };
    let mut cards: Vec<RunCard> = entries
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| {
            let raw = fs::read_to_string(e.path()).ok()?;
            serde_json::from_str(&raw).ok()
        })
        .collect();
    cards.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    cards
}

fn save_card(vault_path: &str, card: &RunCard) -> Result<(), String> {
    let dir = runs_dir(vault_path);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(card).map_err(|e| e.to_string())?;
    fs::write(card_path(vault_path, &card.id), raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn run_card_create(
    state: State<'_, WenmeiState>,
    goal: String,
    wake_secs: Option<u64>,
    human_gate: Option<bool>,
) -> Result<RunCard, String> {
    let vault = active_vault(&state)?;
    let card = RunCard {
        id: format!("run-{}", chrono::Utc::now().timestamp_millis()),
        goal,
        wake: match wake_secs {
            Some(secs) if secs > 0 => WakePolicy::Interval { secs },
            _ => WakePolicy::Manual,
        },
        stop: if human_gate.unwrap_or(true) {
            StopCondition::HumanGate
        } else {
            StopCondition::ChecksPass {
                command: String::new(),
            }
        },
        status: RunStatus::Idle,
        created_at: chrono::Utc::now().to_rfc3339(),
        last_progress_epoch: now_epoch(),
        overdue_notified: false,
    };
    save_card(&vault.path, &card)?;
    append_journal_event(
        &state,
        "task.run_created",
        "heartbeat",
        None,
        format!("Run card created: {}", card.goal),
        serde_json::json!({"run_id": card.id}),
    )?;
    Ok(card)
}

#[tauri::command]
pub fn run_card_list(state: State<'_, WenmeiState>) -> Result<Vec<RunCard>, String> {
    let vault = active_vault(&state)?;
    Ok(load_cards(&vault.path))
}

#[tauri::command]
pub fn run_card_set_status(
    state: State<'_, WenmeiState>,
    id: String,
    status: RunStatus,
) -> Result<RunCard, String> {
    let vault = active_vault(&state)?;
    let mut card = load_cards(&vault.path)
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("No run card {id}"))?;
    card.status = status;
    card.last_progress_epoch = now_epoch();
    card.overdue_notified = false;
    save_card(&vault.path, &card)?;
    append_journal_event(
        &state,
        "task.run_status",
        "heartbeat",
        None,
        format!("Run {} → {:?}", card.id, card.status),
        serde_json::json!({"run_id": card.id}),
    )?;
    Ok(card)
}

/// Progress marker — the orchestrator/observer calls this when a run shows
/// life (task recorded, output observed) so overdue detection resets.
#[tauri::command]
pub fn run_card_touch(state: State<'_, WenmeiState>, id: String) -> Result<(), String> {
    let vault = active_vault(&state)?;
    if let Some(mut card) = load_cards(&vault.path).into_iter().find(|c| c.id == id) {
        card.last_progress_epoch = now_epoch();
        card.overdue_notified = false;
        save_card(&vault.path, &card)?;
    }
    Ok(())
}

#[tauri::command]
pub fn run_card_delete(state: State<'_, WenmeiState>, id: String) -> Result<(), String> {
    let vault = active_vault(&state)?;
    let path = card_path(&vault.path, &id);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Staging dir soft alarm — warn before the review baseline cap bites and
/// files start landing as BaselineMissing (unrestorable on reject).
const STAGING_ALERT_BYTES: u64 = 160 * 1024 * 1024; // 80% of the 200 MB cap
const RESOURCE_CHECK_EVERY_TICKS: u32 = 12; // ~1 min at 5s ticks

fn dir_size(path: &PathBuf) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|e| {
            let p = e.path();
            if p.is_dir() {
                dir_size(&p)
            } else {
                e.metadata().map(|m| m.len()).unwrap_or(0)
            }
        })
        .sum()
}

/// Scheduler thread: scans the active project's run cards and raises
/// overdue/stuck alerts, plus periodic resource checks. Dispatching work
/// into terminals is the orchestrator's job (H11) — this thread only
/// watches and notifies.
pub fn start_heartbeat(app: AppHandle) {
    thread::spawn(move || {
        let mut tick: u32 = 0;
        loop {
        thread::sleep(Duration::from_millis(TICK_MS));
        tick = tick.wrapping_add(1);
        let Some(state) = app.try_state::<WenmeiState>() else {
            continue;
        };
        let Ok(vault) = active_vault(&state) else {
            continue;
        };
        if tick % RESOURCE_CHECK_EVERY_TICKS == 0 {
            let staging = PathBuf::from(&vault.path).join(".wenmei/staging");
            let bytes = dir_size(&staging);
            if bytes > STAGING_ALERT_BYTES {
                emit_notification(
                    &app,
                    "resource.staging",
                    "Review staging near its cap",
                    &format!(
                        "{} MB of baselines staged (cap 200 MB) — approve or reject pending changesets, or new files won't be restorable.",
                        bytes / (1024 * 1024)
                    ),
                    None,
                );
            }
        }
        for mut card in load_cards(&vault.path) {
            if card.status != RunStatus::Running {
                continue;
            }
            let WakePolicy::Interval { secs } = card.wake else {
                continue;
            };
            let idle = now_epoch() - card.last_progress_epoch;
            if idle > (secs * OVERDUE_FACTOR) as i64 && !card.overdue_notified {
                card.status = RunStatus::Stuck;
                card.overdue_notified = true;
                let _ = save_card(&vault.path, &card);
                emit_notification(
                    &app,
                    "task.overdue",
                    "Run stuck",
                    &format!(
                        "\"{}\" has shown no progress for {}m — kill, retry, or take over?",
                        card.goal,
                        idle / 60
                    ),
                    None,
                );
            }
        }
        }
    });
}
