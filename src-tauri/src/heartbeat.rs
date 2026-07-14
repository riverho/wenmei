use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{AppHandle, Manager, State};

use crate::journal::{append_journal_event, emit_notification, NOTIFY_AGENT_DONE};
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

/// Auto-briefing (D2 / case #3, "you return from coffee to a useful
/// briefing"): checked on the same tick cadence as the resource check, not on
/// terminal-session-start (memory-foreman.md's original wording predates the
/// heartbeat engine). Firing only while the window is unfocused, gated by a
/// cooldown and "anything new happened," reuses the exact restraint pattern
/// already established for stuck-run detection below — quiet by default,
/// visible only when there's something to report. `BRIEFING_CHECK_EVERY_TICKS`
/// is just the internal poll granularity (how often we glance at the clock);
/// the actual cooldown is the user-configured `heartbeat_interval_minutes`
/// (Settings › Heartbeat), and the whole check is skipped when
/// `heartbeat_enabled` is off.
const BRIEFING_CHECK_EVERY_TICKS: u32 = 12; // ~1 min at 5s ticks

/// Agent-completion detection cadence — this doesn't need 5s tightness, so
/// it rides a slower multiple of the base tick (~10s focused, ~40s
/// unfocused).
const AGENT_CHECK_EVERY_TICKS: u32 = 2;

/// A live terminal session's data needed for one agent-detection pass,
/// snapshotted from `state.terminals` before the (potentially slow) process
/// walk so the lock isn't held across it.
struct AgentCheckSession {
    session_id: String,
    pid: Pid,
    cwd: String,
    detected: Arc<Mutex<Option<String>>>,
}

/// pid -> direct children, built once per check and reused for every live
/// session rather than re-walking the whole process table per session.
fn children_index(sys: &System) -> HashMap<Pid, Vec<Pid>> {
    let mut idx: HashMap<Pid, Vec<Pid>> = HashMap::new();
    for (pid, process) in sys.processes() {
        if let Some(parent) = process.parent() {
            idx.entry(parent).or_default().push(*pid);
        }
    }
    idx
}

/// Depth-first walk of `root`'s descendants (the shell PTY's own process),
/// looking for one whose name matches an entry in `names` (case-insensitive).
/// Returns the matched allowlist entry, not the raw process name, so the
/// notification reads using whatever casing the user configured.
fn find_agent_descendant(
    sys: &System,
    children: &HashMap<Pid, Vec<Pid>>,
    root: Pid,
    names: &[String],
) -> Option<String> {
    let mut stack = vec![root];
    let mut visited = HashSet::new();
    while let Some(pid) = stack.pop() {
        if !visited.insert(pid) {
            continue;
        }
        let Some(kids) = children.get(&pid) else {
            continue;
        };
        for &kid in kids {
            if let Some(process) = sys.process(kid) {
                let pname = process.name().to_string_lossy().to_lowercase();
                if let Some(matched) = names.iter().find(|n| n.to_lowercase() == pname) {
                    return Some(matched.clone());
                }
            }
            stack.push(kid);
        }
    }
    None
}

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
        let mut last_prompt_hash: u64 = 0;
        // vault_id -> (epoch a briefing last fired, ts of the newest journal
        // event it covered). In-memory only — a restart just resets timing,
        // which is harmless.
        let mut briefing_state: HashMap<String, (i64, String)> = HashMap::new();
        // Reused across ticks rather than reconstructed — refreshing an
        // existing System is far cheaper than rebuilding the process table
        // from scratch every check.
        let mut sys = System::new();
        loop {
        // Back off 4x while the window is unfocused, matching polling.rs —
        // stuck/overdue detection and resource checks still fire, just on a
        // longer wall-clock cadence, so an idle app stops waking every 5s.
        let focused = app
            .get_webview_window("main")
            .and_then(|w| w.is_focused().ok())
            .unwrap_or(false);
        let interval = if focused { TICK_MS } else { TICK_MS * 4 };
        thread::sleep(Duration::from_millis(interval));
        tick = tick.wrapping_add(1);
        let Some(state) = app.try_state::<WenmeiState>() else {
            continue;
        };
        // Approval relay (H10): scan the active terminal for actionable
        // prompts; dedup on the screen hash so one prompt alerts once.
        if let Some(detected) = crate::approval::detect_active_prompt(&state) {
            if detected.screen_hash != last_prompt_hash {
                last_prompt_hash = detected.screen_hash;
                crate::approval::alert_prompt(&app, &state, &detected);
            }
        }
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
        let (heartbeat_enabled, heartbeat_interval_secs) = {
            let app_state = state.app_state.lock().unwrap();
            (
                app_state.heartbeat_enabled,
                i64::from(app_state.heartbeat_interval_minutes) * 60,
            )
        };
        if tick % BRIEFING_CHECK_EVERY_TICKS == 0 && heartbeat_enabled {
            let focused = app
                .get_webview_window("main")
                .and_then(|w| w.is_focused().ok())
                .unwrap_or(true);
            if !focused {
                if let Some(state_for_events) = app.try_state::<WenmeiState>() {
                    if let Ok(events) =
                        crate::journal::list_journal_events(Some(1), state_for_events)
                    {
                        if let Some(latest) = events.first() {
                            let (last_shown, last_seen_ts) = briefing_state
                                .get(&vault.id)
                                .cloned()
                                .unwrap_or((0, String::new()));
                            let has_new = latest.ts != last_seen_ts;
                            let cooled_down = now_epoch() - last_shown > heartbeat_interval_secs;
                            if has_new && cooled_down {
                                if let Some(state_for_briefing) =
                                    app.try_state::<WenmeiState>()
                                {
                                    if let Ok(briefing) = crate::journal::build_briefing(
                                        Some(20),
                                        state_for_briefing,
                                    ) {
                                        emit_notification(
                                            &app,
                                            "briefing.ready",
                                            "While you were away",
                                            &briefing,
                                            None,
                                        );
                                        briefing_state.insert(
                                            vault.id.clone(),
                                            (now_epoch(), latest.ts.clone()),
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        // Agent-completion detection (docs/design/sentinel-ledger.md-style
        // "alerts with hands", process-name variant): watch each live
        // terminal's child processes for a known agent binary, and notify
        // when it goes from present to absent — the agent exited while the
        // shell/PTY itself stayed alive, i.e. it finished its task.
        if tick % AGENT_CHECK_EVERY_TICKS == 0 && heartbeat_enabled {
            let agent_names = {
                let app_state = state.app_state.lock().unwrap();
                app_state.agent_process_names.clone()
            };
            if !agent_names.is_empty() {
                sys.refresh_processes(ProcessesToUpdate::All, true);
                let children = children_index(&sys);
                let active_id = state.active_terminal_id.lock().unwrap().clone();
                let sessions: Vec<AgentCheckSession> = {
                    let terminals = state.terminals.lock().unwrap();
                    terminals
                        .values()
                        .filter_map(|s| {
                            let pid = s.child.lock().unwrap().process_id()?;
                            Some(AgentCheckSession {
                                session_id: s.session_id.clone(),
                                pid: Pid::from_u32(pid),
                                cwd: s.cwd.clone(),
                                detected: s.detected_agent.clone(),
                            })
                        })
                        .collect()
                };
                for session in &sessions {
                    let found =
                        find_agent_descendant(&sys, &children, session.pid, &agent_names);
                    let prev = {
                        let mut cache = session.detected.lock().unwrap();
                        let prev = cache.clone();
                        *cache = found.clone();
                        prev
                    };
                    if let (Some(name), None) = (&prev, &found) {
                        let watched =
                            focused && active_id.as_deref() == Some(session.session_id.as_str());
                        if !watched {
                            emit_notification(
                                &app,
                                NOTIFY_AGENT_DONE,
                                &format!("{name} finished"),
                                &format!("Agent process exited in {}", session.cwd),
                                Some(session.session_id.clone()),
                            );
                            let _ = append_journal_event(
                                &state,
                                "agent.task_done",
                                "agent-detect",
                                None,
                                format!("{name} finished in {}", session.cwd),
                                serde_json::json!({
                                    "session_id": session.session_id,
                                    "agent": name,
                                }),
                            );
                        }
                    }
                }
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
