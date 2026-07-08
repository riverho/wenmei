use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use tauri::Manager;

use crate::{journal, nightshift, review, terminal};
use crate::state::{active_terminal_context, active_vault, config_dir, WenmeiState};

const CONTROL_FILE: &str = "wenmei-control.json";

#[derive(Debug, Clone, Serialize)]
struct ControlDiscovery {
    version: u8,
    url: String,
    token: String,
    pid: u32,
}

#[derive(Debug, Deserialize)]
struct RpcRequest {
    id: Option<serde_json::Value>,
    command: String,
    params: Option<serde_json::Value>,
}

fn token() -> String {
    format!(
        "{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    )
}

fn write_discovery(path: &Path, discovery: &ControlDiscovery) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(discovery).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

fn write_discovery_files(app: &tauri::AppHandle, discovery: &ControlDiscovery) {
    let _ = write_discovery(&config_dir().join(CONTROL_FILE), discovery);
    let state = app.state::<WenmeiState>();
    if let Ok(vault) = active_vault(&state) {
        let _ = write_discovery(
            &PathBuf::from(vault.path).join(".wenmei").join(CONTROL_FILE),
            discovery,
        );
    }
}

fn http_response(status: &str, body: serde_json::Value) -> Vec<u8> {
    let raw = serde_json::to_vec(&body).unwrap_or_else(|_| b"{\"ok\":false}".to_vec());
    let headers = format!(
        "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status,
        raw.len()
    );
    [headers.as_bytes(), raw.as_slice()].concat()
}

fn parse_body(raw: &str) -> &str {
    raw.split_once("\r\n\r\n").map(|(_, body)| body).unwrap_or("")
}

fn authorized(raw: &str, token: &str) -> bool {
    raw.lines().any(|line| {
        line.eq_ignore_ascii_case(&format!("Authorization: Bearer {}", token))
            || line == format!("authorization: Bearer {}", token)
    })
}

fn app_status(app: &tauri::AppHandle) -> serde_json::Value {
    let state = app.state::<WenmeiState>();
    let vault = active_vault(&state).ok();
    let app_state = state.app_state.lock().unwrap();
    let review_active = state.review_session.lock().unwrap().is_some();
    json!({
        "app": "wenmei",
        "control": "ok",
        "active_vault_id": app_state.active_vault_id,
        "active_sandbox_id": app_state.active_sandbox_id,
        "open_mode": app_state.open_mode,
        "review_active": review_active,
        "vault": vault.map(|v| json!({
            "id": v.id,
            "name": v.name,
            "path": v.path,
        })),
    })
}

fn param_string(params: &Option<serde_json::Value>, key: &str) -> Result<String, String> {
    params
        .as_ref()
        .and_then(|p| p.get(key))
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| format!("Missing string param: {}", key))
}

fn param_optional_string(params: &Option<serde_json::Value>, key: &str) -> Option<String> {
    params
        .as_ref()
        .and_then(|p| p.get(key))
        .and_then(|v| v.as_str())
        .map(String::from)
}

fn param_u16(params: &Option<serde_json::Value>, key: &str, default: u16) -> u16 {
    params
        .as_ref()
        .and_then(|p| p.get(key))
        .and_then(|v| v.as_u64())
        .and_then(|v| u16::try_from(v).ok())
        .unwrap_or(default)
}

fn param_bool(params: &Option<serde_json::Value>, key: &str, default: bool) -> bool {
    params
        .as_ref()
        .and_then(|p| p.get(key))
        .and_then(|v| v.as_bool())
        .unwrap_or(default)
}

fn review_ledger(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    let state = app.state::<WenmeiState>();
    let session_id = state
        .review_session
        .lock()
        .unwrap()
        .as_ref()
        .map(|session| session.id.clone())
        .ok_or_else(|| "No active review session".to_string())?;
    let vault = active_vault(&state)?;
    let path = PathBuf::from(vault.path)
        .join(".wenmei")
        .join("staging")
        .join(&session_id)
        .join("review.jsonl");
    let raw = fs::read_to_string(&path).unwrap_or_default();
    let rows: Vec<serde_json::Value> = raw
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    Ok(json!({
        "session_id": session_id,
        "path": path,
        "entries": rows,
    }))
}

fn control_review_event(
    app: &tauri::AppHandle,
    kind: &str,
    path: Option<String>,
    summary: String,
    metadata: serde_json::Value,
) {
    let state = app.state::<WenmeiState>();
    let _ = journal::append_journal_event(&state, kind, "control-plane", path, summary, metadata);
}

fn sandbox_run(app: &tauri::AppHandle, command: String) -> Result<serde_json::Value, String> {
    let state = app.state::<WenmeiState>();
    let ctx = active_terminal_context(&state)?;
    let output = Command::new("/bin/sh")
        .arg("-lc")
        .arg(&command)
        .current_dir(&ctx.cwd)
        .output()
        .map_err(|e| e.to_string())?;
    let code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let _ = journal::append_journal_event(
        &state,
        "control.sandbox_run",
        "control-plane",
        None,
        format!("Control plane ran sandbox command with status {}", code),
        json!({"command": command, "status": code}),
    );
    Ok(json!({
        "status": code,
        "success": output.status.success(),
        "stdout": stdout,
        "stderr": stderr,
        "cwd": ctx.cwd,
    }))
}

fn terminal_snapshot(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    let state = app.state::<WenmeiState>();
    let current = state.terminal.lock().unwrap();
    let session = current
        .as_ref()
        .ok_or_else(|| "Terminal is not running".to_string())?;
    let snapshot = session.backlog.lock().unwrap().clone();
    Ok(json!({
        "session_id": session.session_id,
        "cwd": session.cwd,
        "log_file": session.log_file,
        "narration_enabled": session.narration_enabled,
        "bytes": snapshot.len(),
        "text": String::from_utf8_lossy(&snapshot).to_string(),
    }))
}

fn handle_rpc(app: &tauri::AppHandle, request: RpcRequest) -> serde_json::Value {
    let id = request.id.clone().unwrap_or_else(|| json!(null));
    let result = match request.command.as_str() {
        "app.status" => Ok(app_status(app)),
        "review.start" => {
            let state = app.state::<WenmeiState>();
            review::review_session_start(state, app.clone()).map(|session_id| {
                control_review_event(
                    app,
                    "control.review_started",
                    None,
                    format!("Control plane started review session {}", session_id),
                    json!({"session_id": session_id}),
                );
                json!({ "session_id": session_id })
            })
        }
        "review.changeset" => {
            let state = app.state::<WenmeiState>();
            review::review_changeset(state).map(|entries| json!(entries))
        }
        "review.annotate" => {
            let path = param_string(&request.params, "path");
            let reviewer = param_string(&request.params, "reviewer");
            let annotation = param_string(&request.params, "annotation");
            match (path, reviewer, annotation) {
                (Ok(path), Ok(reviewer), Ok(annotation)) => {
                    let risk_level = param_optional_string(&request.params, "risk_level");
                    let proposed_decision =
                        param_optional_string(&request.params, "proposed_decision");
                    let state = app.state::<WenmeiState>();
                    review::review_annotate(
                        state,
                        path.clone(),
                        reviewer.clone(),
                        risk_level,
                        proposed_decision,
                        annotation.clone(),
                    )
                    .map(|_| {
                        control_review_event(
                            app,
                            "control.review_annotated",
                            Some(path),
                            annotation,
                            json!({"reviewer": reviewer}),
                        );
                        json!({"ok": true})
                    })
                }
                (Err(err), _, _) | (_, Err(err), _) | (_, _, Err(err)) => Err(err),
            }
        }
        "review.approve" => {
            let path = param_string(&request.params, "path");
            match path {
                Ok(path) => {
                    let state = app.state::<WenmeiState>();
                    review::review_approve(state, app.clone(), path.clone()).map(|_| {
                        control_review_event(
                            app,
                            "control.review_approved",
                            Some(path),
                            "Control plane approved review item".to_string(),
                            json!({}),
                        );
                        json!({"ok": true})
                    })
                }
                Err(err) => Err(err),
            }
        }
        "review.reject" => {
            let path = param_string(&request.params, "path");
            match path {
                Ok(path) => {
                    let state = app.state::<WenmeiState>();
                    review::review_reject(state, app.clone(), path.clone()).map(|_| {
                        control_review_event(
                            app,
                            "control.review_rejected",
                            Some(path),
                            "Control plane rejected review item".to_string(),
                            json!({}),
                        );
                        json!({"ok": true})
                    })
                }
                Err(err) => Err(err),
            }
        }
        "review.ledger" => review_ledger(app),
        "briefing.build" => {
            let limit = param_u16(&request.params, "limit", 20) as usize;
            let state = app.state::<WenmeiState>();
            journal::build_briefing(Some(limit), state).map(|briefing| json!({ "briefing": briefing }))
        }
        "audit.export" => {
            let state = app.state::<WenmeiState>();
            journal::export_audit(state).map(|export| json!(export))
        }
        "nightshift.start" => {
            let state = app.state::<WenmeiState>();
            nightshift::night_shift_start(state, app.clone()).map(|run| json!(run))
        }
        "nightshift.status" => {
            let state = app.state::<WenmeiState>();
            nightshift::night_shift_status(state).map(|run| json!(run))
        }
        "terminal.start" => {
            let rows = param_u16(&request.params, "rows", 24);
            let cols = param_u16(&request.params, "cols", 80);
            let force_restart = param_bool(&request.params, "force_restart", false);
            let state = app.state::<WenmeiState>();
            terminal::terminal_start(app.clone(), state, rows, cols, Some(force_restart))
                .map(|started| json!(started))
        }
        "terminal.type" => {
            let text = param_string(&request.params, "text");
            match text {
                Ok(text) => {
                    let origin = param_optional_string(&request.params, "origin")
                        .unwrap_or_else(|| "control-plane".to_string());
                    let state = app.state::<WenmeiState>();
                    terminal::pi_type_into_terminal(state, text, origin)
                        .map(|_| json!({"ok": true}))
                }
                Err(err) => Err(err),
            }
        }
        "terminal.narrate" => {
            let enabled = param_bool(&request.params, "enabled", true);
            let state = app.state::<WenmeiState>();
            terminal::terminal_set_narration_enabled(state, enabled)
                .map(|enabled| json!({"enabled": enabled}))
        }
        "terminal.snapshot" => terminal_snapshot(app),
        "terminal.stop" => {
            let state = app.state::<WenmeiState>();
            terminal::terminal_stop(state).map(|_| json!({"ok": true}))
        }
        "sandbox.run" => {
            let command = param_string(&request.params, "command");
            match command {
                Ok(command) => sandbox_run(app, command),
                Err(err) => Err(err),
            }
        }
        other => Err(format!("Unknown command: {}", other)),
    };

    match result {
        Ok(result) => json!({ "id": id, "ok": true, "result": result }),
        Err(error) => json!({ "id": id, "ok": false, "error": error }),
    }
}

fn handle_connection(mut stream: TcpStream, app: tauri::AppHandle, token: String) {
    let mut buf = vec![0u8; 64 * 1024];
    let read = match stream.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return,
    };
    let raw = String::from_utf8_lossy(&buf[..read]);
    if !raw.starts_with("POST /rpc ") {
        let _ = stream.write_all(&http_response(
            "404 Not Found",
            json!({"ok": false, "error": "not found"}),
        ));
        return;
    }
    if !authorized(&raw, &token) {
        let _ = stream.write_all(&http_response(
            "401 Unauthorized",
            json!({"ok": false, "error": "unauthorized"}),
        ));
        return;
    }

    let response = match serde_json::from_str::<RpcRequest>(parse_body(&raw)) {
        Ok(request) => handle_rpc(&app, request),
        Err(err) => json!({"id": null, "ok": false, "error": err.to_string()}),
    };
    let _ = stream.write_all(&http_response("200 OK", response));
}

pub fn start_control_server(app: tauri::AppHandle) {
    thread::spawn(move || {
        let listener = match TcpListener::bind("127.0.0.1:0") {
            Ok(listener) => listener,
            Err(err) => {
                eprintln!("wenmei control server failed to bind: {}", err);
                return;
            }
        };
        let addr = match listener.local_addr() {
            Ok(addr) => addr,
            Err(err) => {
                eprintln!("wenmei control server has no local addr: {}", err);
                return;
            }
        };
        let token = token();
        let discovery = ControlDiscovery {
            version: 1,
            url: format!("http://{}", addr),
            token: token.clone(),
            pid: std::process::id(),
        };
        write_discovery_files(&app, &discovery);

        for stream in listener.incoming().flatten() {
            let app = app.clone();
            let token = token.clone();
            thread::spawn(move || handle_connection(stream, app, token));
        }
    });
}
