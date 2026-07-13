use portable_pty::{native_pty_system, MasterPty, PtySize};
use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::journal::{
    append_journal_event, emit_files_changed, emit_notification, NOTIFY_TERMINAL_DONE,
};
use crate::narration::{spawn_narration_flush_thread, NarrationBuffer, SharedNarrationBuffer};
use crate::platform::Platform;
use crate::state::{
    log_action, save_state, terminal_context_for, terminal_log_file, terminal_pi_session_dir,
    TerminalSession, WenmeiState,
};

/// The focused tab id, for callers that don't pass one.
fn active_terminal_id(state: &State<'_, WenmeiState>) -> Option<String> {
    state.active_terminal_id.lock().unwrap().clone()
}

/// Run `f` against the session with `id`, or the active session if `id` is
/// None. Errors if no such live session exists.
fn with_session<R>(
    state: &State<'_, WenmeiState>,
    id: Option<&str>,
    f: impl FnOnce(&TerminalSession) -> Result<R, String>,
) -> Result<R, String> {
    let key = id
        .map(|s| s.to_string())
        .or_else(|| active_terminal_id(state))
        .ok_or_else(|| "Terminal is not running".to_string())?;
    let terminals = state.terminals.lock().unwrap();
    let session = terminals
        .get(&key)
        .ok_or_else(|| "Terminal is not running".to_string())?;
    f(session)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TerminalActivity {
    /// Output is flowing right now.
    Active,
    /// Alive but quiet for a while.
    Idle,
    /// Sitting on a recognized input prompt — wants a human.
    NeedsInput,
    /// The PTY errored or died.
    Stuck,
}

/// Quiet-for-this-long (ms) before an Active session is reported Idle.
const STATUS_IDLE_MS: u128 = 2500;

#[derive(Debug, Clone, Serialize)]
pub struct TerminalTabStatus {
    pub session_id: String,
    pub activity: TerminalActivity,
    pub idle_ms: u64,
}

/// Per-tab live status for every running session, derived from each session's
/// own narration buffer (last-output age) and the approval-relay prompt
/// detector (needs-input). Zero-cost snapshot — the frontend polls it to paint
/// the tab dots and the needs-input attention badge. Dead sessions simply
/// aren't in the map, so their tabs fall back to "unknown".
#[tauri::command]
pub fn terminal_statuses(state: State<'_, WenmeiState>) -> Vec<TerminalTabStatus> {
    let terminals = state.terminals.lock().unwrap();
    terminals
        .values()
        .map(|session| {
            let nb = session.narration_buffer.lock().unwrap();
            let idle_ms = nb.idle_ms();
            let activity = if crate::approval::tail_has_prompt(&nb.recent_text(12)) {
                TerminalActivity::NeedsInput
            } else if idle_ms >= STATUS_IDLE_MS {
                TerminalActivity::Idle
            } else {
                TerminalActivity::Active
            };
            TerminalTabStatus {
                session_id: session.session_id.clone(),
                activity,
                idle_ms: idle_ms as u64,
            }
        })
        .collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct TerminalOutput {
    pub session_id: String,
    pub data: Vec<u8>,
    pub activity: TerminalActivity,
}

#[derive(Debug, Clone, Serialize)]
pub struct TerminalStarted {
    pub session_id: String,
    pub cwd: String,
    pub log_file: String,
    pub reused: bool,
    pub snapshot: Vec<u8>,
    pub activity: TerminalActivity,
}

#[derive(serde::Deserialize)]
pub struct PtyCommand {
    pub cmd: String,
}

#[derive(serde::Serialize)]
pub struct PtyResult {
    pub failed: bool,
}

#[tauri::command]
pub async fn pty_run_commands(
    commands: Vec<PtyCommand>,
    window: tauri::Window,
    _app: tauri::AppHandle,
) -> Result<PtyResult, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let script: Vec<String> = commands.iter().map(|c| c.cmd.clone()).collect();
    let cmd_builder = crate::platform::Current::build_pty_command(&script);

    let mut child = pair
        .slave
        .spawn_command(cmd_builder)
        .map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let window_clone = window.clone();

    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    if let Ok(text) = String::from_utf8(data.clone()) {
                        let _ = window_clone.emit("pty-output", text);
                    }
                }
                Err(_) => break,
            }
        }
    });

    let status = child.wait().map_err(|e| e.to_string())?;
    drop(writer);

    Ok(PtyResult {
        failed: !status.success(),
    })
}

#[tauri::command]
pub fn terminal_start(
    app: AppHandle,
    state: State<'_, WenmeiState>,
    session_id: Option<String>,
    sandbox_id: Option<String>,
    rows: u16,
    cols: u16,
    force_restart: Option<bool>,
) -> Result<TerminalStarted, String> {
    // Scope to the tab's own sandbox binding when it has one, so a background
    // tab is not force-reset when the globally-focused sandbox changes.
    let ctx = terminal_context_for(&state, sandbox_id.as_deref())?;
    // The tab id is the session key. Fall back to a sandbox-derived id for
    // legacy single-terminal callers.
    let session_id = session_id
        .filter(|s| !s.trim().is_empty())
        .or_else(|| state.app_state.lock().unwrap().active_sandbox_id.clone())
        .unwrap_or_else(|| "default-terminal".to_string());
    let cwd = ctx.cwd.clone();
    let terminal_cwd = crate::platform::Current::terminal_cwd(&cwd);
    let log_file = terminal_log_file(&ctx);
    let desired_cwd = cwd.to_string_lossy().to_string();
    let desired_log_file = log_file.to_string_lossy().to_string();
    let pi_session_dir = terminal_pi_session_dir(&ctx);

    {
        let mut terminals = state.terminals.lock().unwrap();
        if let Some(session) = terminals.get(&session_id) {
            if session.cwd == desired_cwd && session.log_file == desired_log_file {
                let _ = session.master.lock().unwrap().resize(PtySize {
                    rows: rows.max(8),
                    cols: cols.max(20),
                    pixel_width: 0,
                    pixel_height: 0,
                });
                let started = TerminalStarted {
                    session_id: session.session_id.clone(),
                    cwd: session.cwd.clone(),
                    log_file: session.log_file.clone(),
                    reused: true,
                    snapshot: session.backlog.lock().unwrap().clone(),
                    activity: TerminalActivity::Idle,
                };
                drop(terminals);
                *state.active_terminal_id.lock().unwrap() = Some(session_id.clone());
                return Ok(started);
            }
            if !force_restart.unwrap_or(false) {
                return Err(crate::state::context_switch_requires_reset(
                    "Terminal",
                    &session.cwd,
                    &desired_cwd,
                ));
            }
        }
        if let Some(session) = terminals.remove(&session_id) {
            let _ = session.child.lock().unwrap().kill();
        }
    }

    fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
    if let Some(parent) = log_file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&pi_session_dir).map_err(|e| e.to_string())?;

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(8),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = crate::platform::Current::build_terminal_command(
        &cwd,
        &terminal_cwd,
        &log_file,
        &pi_session_dir,
    );
    cmd.cwd(&terminal_cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    // `NO_COLOR` can be set by the host agent/runtime, but an embedded PTY is
    // a real interactive terminal. Do not leak that host presentation flag or
    // TUI programs such as Claude Code will suppress their ANSI palette.
    cmd.env_remove("NO_COLOR");
    ensure_utf8_locale(&mut cmd);

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let master: Arc<Mutex<Box<dyn MasterPty + Send>>> = Arc::new(Mutex::new(pair.master));
    let child = Arc::new(Mutex::new(child));
    let backlog = Arc::new(Mutex::new(Vec::<u8>::new()));
    let narration_buffer: SharedNarrationBuffer = Arc::new(Mutex::new(NarrationBuffer::new()));

    // New sessions inherit the machine-level narrate default (Settings ›
    // Terminal, ships on) — the per-tab toggle can still switch it off.
    let narrate_default = state.app_state.lock().unwrap().narrate_by_default;
    if narrate_default {
        if let Ok(mut nb) = narration_buffer.lock() {
            nb.set_enabled(true);
        }
    }

    {
        let mut terminals = state.terminals.lock().unwrap();
        terminals.insert(
            session_id.clone(),
            TerminalSession {
                session_id: session_id.clone(),
                writer: Arc::new(Mutex::new(writer)),
                child,
                master: master.clone(),
                cwd: desired_cwd.clone(),
                log_file: desired_log_file.clone(),
                backlog: backlog.clone(),
                narration_buffer: narration_buffer.clone(),
                narration_enabled: narrate_default,
            },
        );
    }
    *state.active_terminal_id.lock().unwrap() = Some(session_id.clone());

    spawn_narration_flush_thread(app.clone(), narration_buffer.clone(), session_id.clone());

    let app_for_read = app.clone();
    let session_id_for_read = session_id.clone();
    let buf_for_read = narration_buffer.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    if let Ok(mut stored) = backlog.lock() {
                        stored.extend_from_slice(&data);
                        let max = 2 * 1024 * 1024;
                        if stored.len() > max {
                            let drain_to = stored.len() - max;
                            stored.drain(0..drain_to);
                        }
                    }
                    // push_bytes maintains the always-on screen tail that the
                    // approval relay reads for needs_input prompt detection
                    // (approval.rs / docs/design/sentinel-ledger.md §3), even
                    // when narration is off.
                    if let Ok(mut nb) = buf_for_read.lock() {
                        nb.push_bytes(&data);
                    }
                    let _ = app_for_read.emit(
                        "terminal-output",
                        TerminalOutput {
                            session_id: session_id_for_read.clone(),
                            data,
                            activity: TerminalActivity::Active,
                        },
                    );
                }
                Err(e) => {
                    let _ = app_for_read.emit(
                        "terminal-output",
                        TerminalOutput {
                            session_id: session_id_for_read.clone(),
                            data: format!("\r\n[Wenmei terminal read error: {}]\r\n", e)
                                .into_bytes(),
                            activity: TerminalActivity::Stuck,
                        },
                    );
                    break;
                }
            }
        }
        // The PTY closed — drop the dead session from the map so a new tab
        // with the same id can start clean.
        if let Some(state) = app_for_read.try_state::<WenmeiState>() {
            state.terminals.lock().unwrap().remove(&session_id_for_read);
            let mut active = state.active_terminal_id.lock().unwrap();
            if active.as_deref() == Some(session_id_for_read.as_str()) {
                *active = None;
            }
        }
        emit_notification(
            &app_for_read,
            NOTIFY_TERMINAL_DONE,
            "Terminal session ended",
            "The embedded terminal PTY closed.",
            Some(session_id_for_read.clone()),
        );
    });

    log_action(
        &state,
        format!(
            "opened embedded terminal at {} (log: {})",
            cwd.to_string_lossy(),
            log_file.to_string_lossy()
        ),
    );
    let _ = append_journal_event(
        &state,
        "terminal.started",
        "terminal",
        None,
        format!("Terminal started at {}", cwd.to_string_lossy()),
        serde_json::json!({"log_file": desired_log_file.clone()}),
    );
    emit_files_changed(&app, "terminal.started");
    let _ = save_state(&state);

    Ok(TerminalStarted {
        session_id,
        cwd: desired_cwd,
        log_file: desired_log_file,
        reused: false,
        snapshot: vec![],
        activity: TerminalActivity::Idle,
    })
}

fn ensure_utf8_locale(cmd: &mut portable_pty::CommandBuilder) {
    // Apps launched from Finder/Dock do not reliably inherit the user's shell
    // locale. TUIs use these variables for wcwidth and output encoding, so give
    // the PTY a UTF-8 locale when the parent process has no UTF-8 locale at all.
    let has_utf8_locale = ["LC_ALL", "LC_CTYPE", "LANG"].iter().any(|name| {
        std::env::var(name).is_ok_and(|value| {
            let normalized = value.to_ascii_lowercase().replace('-', "");
            normalized.contains("utf8")
        })
    });
    if !has_utf8_locale {
        cmd.env("LANG", "C.UTF-8");
        cmd.env("LC_CTYPE", "C.UTF-8");
    }
}

#[tauri::command]
pub fn terminal_write(
    state: State<'_, WenmeiState>,
    session_id: Option<String>,
    data: String,
) -> Result<(), String> {
    with_session(&state, session_id.as_deref(), |session| {
        let mut writer = session.writer.lock().unwrap();
        writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn pi_type_into_terminal(
    state: State<'_, WenmeiState>,
    text: String,
    origin: String,
) -> Result<(), String> {
    // Injects into the active tab (the sidecar steers what you're watching).
    with_session(&state, None, |session| {
        let mut writer = session.writer.lock().unwrap();
        writer.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())
    })?;

    let _ = append_journal_event(
        &state,
        "steering.injected",
        "control-plane",
        None,
        format!("Injected {} bytes into terminal from {}", text.len(), origin),
        serde_json::json!({"origin": origin, "bytes": text.len()}),
    );
    Ok(())
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, WenmeiState>,
    session_id: Option<String>,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    with_session(&state, session_id.as_deref(), |session| {
        session
            .master
            .lock()
            .unwrap()
            .resize(PtySize {
                rows: rows.max(8),
                cols: cols.max(20),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn terminal_stop(
    state: State<'_, WenmeiState>,
    session_id: Option<String>,
) -> Result<(), String> {
    let key = session_id.or_else(|| active_terminal_id(&state));
    if let Some(key) = key {
        if let Some(session) = state.terminals.lock().unwrap().remove(&key) {
            let _ = session.child.lock().unwrap().kill();
        }
        let mut active = state.active_terminal_id.lock().unwrap();
        if active.as_deref() == Some(key.as_str()) {
            *active = state.terminals.lock().unwrap().keys().next().cloned();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn terminal_set_active(
    state: State<'_, WenmeiState>,
    session_id: String,
) -> Result<(), String> {
    *state.active_terminal_id.lock().unwrap() = Some(session_id);
    Ok(())
}

#[tauri::command]
pub fn terminal_set_narration_enabled(
    state: State<'_, WenmeiState>,
    session_id: Option<String>,
    enabled: bool,
) -> Result<bool, String> {
    let key = session_id
        .or_else(|| active_terminal_id(&state))
        .ok_or_else(|| "Terminal is not running".to_string())?;
    let mut terminals = state.terminals.lock().unwrap();
    let session = terminals
        .get_mut(&key)
        .ok_or_else(|| "Terminal is not running".to_string())?;
    session.narration_enabled = enabled;
    if let Ok(mut nb) = session.narration_buffer.lock() {
        nb.set_enabled(enabled);
    }
    Ok(enabled)
}
