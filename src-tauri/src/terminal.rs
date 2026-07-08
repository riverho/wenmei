use portable_pty::{native_pty_system, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, State};

use crate::journal::{
    append_journal_event, emit_files_changed, emit_notification, NOTIFY_TERMINAL_DONE,
};
use crate::narration::{spawn_narration_flush_thread, NarrationBuffer, SharedNarrationBuffer};
use crate::platform::Platform;
use crate::state::{
    active_terminal_context, log_action, save_state, terminal_log_file, terminal_pi_session_dir,
    TerminalSession, WenmeiState,
};

type TerminalSessionMap = HashMap<String, String>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminalActivity {
    Active,
    Idle,
    Stuck,
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
    rows: u16,
    cols: u16,
    force_restart: Option<bool>,
) -> Result<TerminalStarted, String> {
    let ctx = active_terminal_context(&state)?;
    let session_id = state
        .app_state
        .lock()
        .unwrap()
        .active_sandbox_id
        .clone()
        .unwrap_or_else(|| "default-terminal".to_string());
    let cwd = ctx.cwd.clone();
    let terminal_cwd = crate::platform::Current::terminal_cwd(&cwd);
    let log_file = terminal_log_file(&ctx);
    let desired_cwd = cwd.to_string_lossy().to_string();
    let desired_log_file = log_file.to_string_lossy().to_string();
    let pi_session_dir = terminal_pi_session_dir(&ctx);

    {
        let mut current = state.terminal.lock().unwrap();
        if let Some(session) = current.as_ref() {
            if session.cwd == desired_cwd && session.log_file == desired_log_file {
                let _ = session.master.lock().unwrap().resize(PtySize {
                    rows: rows.max(8),
                    cols: cols.max(20),
                    pixel_width: 0,
                    pixel_height: 0,
                });
                return Ok(TerminalStarted {
                    session_id: session.session_id.clone(),
                    cwd: session.cwd.clone(),
                    log_file: session.log_file.clone(),
                    reused: true,
                    snapshot: session.backlog.lock().unwrap().clone(),
                    activity: TerminalActivity::Idle,
                });
            }
            if !force_restart.unwrap_or(false) {
                return Err(crate::state::context_switch_requires_reset(
                    "Terminal",
                    &session.cwd,
                    &desired_cwd,
                ));
            }
        }
        if let Some(session) = current.take() {
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
        let mut current = state.terminal.lock().unwrap();
        *current = Some(TerminalSession {
            session_id: session_id.clone(),
            writer: Arc::new(Mutex::new(writer)),
            child,
            master: master.clone(),
            cwd: desired_cwd.clone(),
            log_file: desired_log_file.clone(),
            backlog: backlog.clone(),
            narration_buffer: narration_buffer.clone(),
            narration_enabled: narrate_default,
        });
    }
    if let Ok(mut sessions) = state.terminal_sessions.lock() {
        let sessions: &mut TerminalSessionMap = &mut sessions;
        sessions.insert(session_id.clone(), desired_cwd.clone());
    }

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
        emit_notification(
            &app_for_read,
            NOTIFY_TERMINAL_DONE,
            "Terminal session ended",
            "The embedded terminal PTY closed.",
            None,
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

#[tauri::command]
pub fn terminal_write(state: State<'_, WenmeiState>, data: String) -> Result<(), String> {
    let current = state.terminal.lock().unwrap();
    let session = current
        .as_ref()
        .ok_or_else(|| "Terminal is not running".to_string())?;
    let mut writer = session.writer.lock().unwrap();
    writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pi_type_into_terminal(
    state: State<'_, WenmeiState>,
    text: String,
    origin: String,
) -> Result<(), String> {
    {
        let current = state.terminal.lock().unwrap();
        let session = current
            .as_ref()
            .ok_or_else(|| "Terminal is not running".to_string())?;
        let mut writer = session.writer.lock().unwrap();
        writer
            .write_all(text.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
    }

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
pub fn terminal_resize(state: State<'_, WenmeiState>, rows: u16, cols: u16) -> Result<(), String> {
    let current = state.terminal.lock().unwrap();
    let session = current
        .as_ref()
        .ok_or_else(|| "Terminal is not running".to_string())?;
    let master = session.master.lock().unwrap();
    master
        .resize(PtySize {
            rows: rows.max(8),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_stop(state: State<'_, WenmeiState>) -> Result<(), String> {
    let mut current = state.terminal.lock().unwrap();
    if let Some(session) = current.take() {
        let _ = session.child.lock().unwrap().kill();
    }
    Ok(())
}

#[tauri::command]
pub fn terminal_set_narration_enabled(
    state: State<'_, WenmeiState>,
    enabled: bool,
) -> Result<bool, String> {
    let mut current = state.terminal.lock().unwrap();
    let session = current
        .as_mut()
        .ok_or_else(|| "Terminal is not running".to_string())?;
    session.narration_enabled = enabled;
    if let Ok(mut nb) = session.narration_buffer.lock() {
        nb.set_enabled(enabled);
    }
    Ok(enabled)
}
