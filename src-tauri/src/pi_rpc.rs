use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command as ProcessCommand, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, State};

use crate::journal::append_journal_event;
use crate::state::{
    active_terminal_context, log_action, panel_pi_session_dir, save_state, PiRpcSession,
    WenmeiState,
};

fn pi_user_bin() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".pi").join("agent").join("bin"))
}

fn process_path() -> String {
    let mut parts: Vec<String> = vec![
        "/usr/local/bin".to_string(),
        "/opt/homebrew/bin".to_string(),
    ];
    if let Some(user_bin) = pi_user_bin() {
        parts.push(user_bin.to_string_lossy().to_string());
    }
    for fallback in ["/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
        parts.push(fallback.to_string());
    }
    let current = std::env::var("PATH").unwrap_or_default();
    for part in current.split(':').filter(|p| !p.is_empty()) {
        if !parts.iter().any(|existing| existing == part) {
            parts.push(part.to_string());
        }
    }
    parts.join(":")
}

fn find_pi_executable() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("WENMEI_PI_PATH") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(':').filter(|p| !p.is_empty()) {
            let candidate = PathBuf::from(dir).join("pi");
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    let mut candidates: Vec<PathBuf> = vec![
        PathBuf::from("/usr/local/bin/pi"),
        PathBuf::from("/opt/homebrew/bin/pi"),
    ];
    if let Some(user_bin) = pi_user_bin() {
        candidates.push(user_bin.join("pi"));
    }
    for path in candidates {
        if path.exists() {
            return Ok(path);
        }
    }

    Err("Global Pi executable not found. Expected /usr/local/bin/pi, /opt/homebrew/bin/pi, or ~/.pi/agent/bin/pi. Install/configure Pi globally first.".to_string())
}

fn emit_pi_rpc_line(app: &AppHandle, line: &str) {
    if line.trim().is_empty() {
        return;
    }
    let event = serde_json::from_str::<serde_json::Value>(line).unwrap_or_else(|_| {
        serde_json::json!({
            "type": "client_error",
            "message": format!("Invalid Pi RPC JSON: {}", line)
        })
    });
    let _ = app.emit("pi-rpc-event", PiRpcEvent { event });
}

#[derive(Debug, Clone, Serialize)]
pub struct PiPanelStarted {
    pub cwd: String,
    pub session_dir: String,
    pub reused: bool,
    pub thinking: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PiRpcEvent {
    pub event: serde_json::Value,
}

#[tauri::command]
pub fn pi_panel_start(
    app: AppHandle,
    state: State<'_, WenmeiState>,
    thinking: Option<String>,
    force_restart: Option<bool>,
) -> Result<PiPanelStarted, String> {
    let ctx = active_terminal_context(&state)?;
    let cwd = ctx.cwd.clone();
    let desired_cwd = cwd.to_string_lossy().to_string();
    let session_dir = panel_pi_session_dir(&ctx);
    let desired_session_dir = session_dir.to_string_lossy().to_string();

    {
        let mut current = state.pi_rpc.lock().unwrap();
        if let Some(session) = current.as_ref() {
            if session.cwd == desired_cwd && session.session_dir == desired_session_dir {
                return Ok(PiPanelStarted {
                    cwd: session.cwd.clone(),
                    session_dir: session.session_dir.clone(),
                    reused: true,
                    thinking: session.thinking.clone(),
                });
            }

            if !force_restart.unwrap_or(false) {
                return Err(crate::state::context_switch_requires_reset(
                    "Pi Panel",
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
    fs::create_dir_all(&session_dir).map_err(|e| e.to_string())?;

    let pi_executable = find_pi_executable()?;
    let mut args = vec![
        "--mode".to_string(),
        "rpc".to_string(),
        "--session-dir".to_string(),
        session_dir.to_string_lossy().to_string(),
        "--continue".to_string(),
    ];
    if let Some(level) = thinking
        .as_ref()
        .filter(|s| !s.trim().is_empty() && *s != "global")
    {
        args.push("--thinking".to_string());
        args.push(level.clone());
    }
    let mut child = ProcessCommand::new(&pi_executable)
        .args(args)
        .current_dir(&cwd)
        .env("PATH", process_path())
        .env(
            "LANG",
            std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string()),
        )
        .env(
            "LC_CTYPE",
            std::env::var("LC_CTYPE").unwrap_or_else(|_| "UTF-8".to_string()),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to start global Pi RPC at {}: {}",
                pi_executable.to_string_lossy(),
                e
            )
        })?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Pi RPC stdin unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Pi RPC stdout unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Pi RPC stderr unavailable".to_string())?;

    let child = Arc::new(Mutex::new(child));
    {
        let mut current = state.pi_rpc.lock().unwrap();
        *current = Some(PiRpcSession {
            writer: Arc::new(Mutex::new(stdin)),
            child,
            cwd: desired_cwd.clone(),
            session_dir: desired_session_dir.clone(),
            thinking: thinking.clone().filter(|s| s != "global"),
        });
    }

    let app_stdout = app.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) => break,
                Ok(_) => {
                    if buf.ends_with(b"\n") {
                        buf.pop();
                    }
                    if buf.ends_with(b"\r") {
                        buf.pop();
                    }
                    let line = String::from_utf8_lossy(&buf);
                    emit_pi_rpc_line(&app_stdout, &line);
                }
                Err(e) => {
                    let _ = app_stdout.emit("pi-rpc-event", PiRpcEvent {
                        event: serde_json::json!({"type":"client_error","message": format!("Pi RPC stdout read failed: {}", e)}),
                    });
                    break;
                }
            }
        }
    });

    let app_stderr = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            let _ = app_stderr.emit(
                "pi-rpc-event",
                PiRpcEvent {
                    event: serde_json::json!({"type":"stderr","message": line}),
                },
            );
        }
    });

    log_action(
        &state,
        format!(
            "started Pi Panel RPC at {} (session: {})",
            cwd.to_string_lossy(),
            session_dir.to_string_lossy()
        ),
    );
    let _ = save_state(&state);

    Ok(PiPanelStarted {
        cwd: desired_cwd,
        session_dir: desired_session_dir,
        reused: false,
        thinking: thinking.filter(|s| s != "global"),
    })
}

#[tauri::command]
pub fn pi_panel_prompt(
    state: State<'_, WenmeiState>,
    id: String,
    message: String,
) -> Result<(), String> {
    let _ = append_journal_event(
        &state,
        "pi.prompt",
        "pi-panel",
        None,
        message.chars().take(120).collect(),
        serde_json::json!({"id": id}),
    );
    let current = state.pi_rpc.lock().unwrap();
    let session = current
        .as_ref()
        .ok_or_else(|| "Pi Panel RPC is not running".to_string())?;
    let payload = serde_json::json!({
        "id": id,
        "type": "prompt",
        "message": message,
        "streamingBehavior": "followUp"
    });
    let mut writer = session.writer.lock().unwrap();
    writer
        .write_all(payload.to_string().as_bytes())
        .map_err(|e| e.to_string())?;
    writer.write_all(b"\n").map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pi_panel_restart(
    app: AppHandle,
    state: State<'_, WenmeiState>,
    thinking: Option<String>,
) -> Result<PiPanelStarted, String> {
    let _ = pi_panel_stop(state.clone());
    pi_panel_start(app, state, thinking, Some(true))
}

#[tauri::command]
pub fn pi_panel_abort(state: State<'_, WenmeiState>) -> Result<(), String> {
    let current = state.pi_rpc.lock().unwrap();
    let session = current
        .as_ref()
        .ok_or_else(|| "Pi Panel RPC is not running".to_string())?;
    let mut writer = session.writer.lock().unwrap();
    writer
        .write_all(br#"{"type":"abort"}"#)
        .map_err(|e| e.to_string())?;
    writer.write_all(b"\n").map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pi_panel_stop(state: State<'_, WenmeiState>) -> Result<(), String> {
    let mut current = state.pi_rpc.lock().unwrap();
    if let Some(session) = current.take() {
        let _ = session.child.lock().unwrap().kill();
    }
    Ok(())
}
