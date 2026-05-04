use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, State};

use crate::journal::{append_journal_event, emit_files_changed};
use crate::state::{
    active_terminal_context, log_action, save_state, shell_quote, terminal_log_file,
    terminal_pi_session_dir, TerminalSession, WenmeiState,
};

#[cfg(not(target_os = "windows"))]
fn terminal_boot_script(cwd: &Path, log_file: &Path, pi_session_dir: &Path) -> String {
    format!(
        r#"SANDBOX_DIR={sandbox_dir}
LOG_FILE={log_file}
log() {{
  /bin/mkdir -p "$(/usr/bin/dirname "$LOG_FILE")" 2>/dev/null || true
  /bin/echo "[$(/bin/date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE" 2>/dev/null || true
}}
clear
echo 'Wenmei sandbox:'
echo "$SANDBOX_DIR"
echo ''
log "embedded terminal opening cwd=$SANDBOX_DIR"
if ! cd "$SANDBOX_DIR" 2>/tmp/wenmei-cd-error.$$; then
  echo 'Wenmei cannot enter this sandbox folder.'
  echo "Reason: $(cat /tmp/wenmei-cd-error.$$ 2>/dev/null)"
  echo "Log: $LOG_FILE"
  log "cd failed: $(cat /tmp/wenmei-cd-error.$$ 2>/dev/null)"
  /bin/rm -f /tmp/wenmei-cd-error.$$ 2>/dev/null || true
  exec ${{SHELL:-/bin/zsh}} -l
fi
/bin/rm -f /tmp/wenmei-cd-error.$$ 2>/dev/null || true
if command -v pi >/dev/null 2>&1; then
  PI_SESSION_DIR={pi_session_dir}
  /bin/mkdir -p "$PI_SESSION_DIR" 2>/dev/null || true
  PI_PREFLIGHT="/tmp/wenmei-pi-preflight.$$"
  if ! pi --version >"$PI_PREFLIGHT" 2>&1; then
    echo 'Wenmei blocked Pi before it crashed.'
    echo ''
    echo 'Global Pi cannot start in this sandbox cwd.'
    echo 'Most likely cause: macOS privacy permission blocks Node/Pi from reading Documents/Desktop/Downloads.'
    echo ''
    echo 'Original error was saved to:'
    echo "  $LOG_FILE"
    echo ''
    log 'blocked pi: pi --version failed in sandbox'
    /bin/echo '--- pi preflight stderr ---' >> "$LOG_FILE" 2>/dev/null || true
    /bin/cat "$PI_PREFLIGHT" >> "$LOG_FILE" 2>/dev/null || true
    /bin/echo '--- end pi preflight stderr ---' >> "$LOG_FILE" 2>/dev/null || true
    /bin/rm -f "$PI_PREFLIGHT" 2>/dev/null || true
    exec ${{SHELL:-/bin/zsh}} -l
  fi
  pi_version="$(/bin/cat "$PI_PREFLIGHT" 2>/dev/null || echo unknown)"
  /bin/rm -f "$PI_PREFLIGHT" 2>/dev/null || true
  log "starting pi version=$pi_version session_dir=$PI_SESSION_DIR"
  pi --session-dir "$PI_SESSION_DIR" --continue || pi --session-dir "$PI_SESSION_DIR"
  code=$?
  log "pi exited code=$code"
else
  echo 'Pi not found. Configure global Pi first:'
  echo '  npm install -g @mariozechner/pi-coding-agent'
  log 'pi not found'
fi
echo ''
echo 'Exited Pi. Shell remains in Wenmei sandbox.'
exec ${{SHELL:-/bin/zsh}} -l
"#,
        sandbox_dir = shell_quote(&cwd.to_string_lossy()),
        log_file = shell_quote(&log_file.to_string_lossy()),
        pi_session_dir = shell_quote(&pi_session_dir.to_string_lossy())
    )
}

#[derive(Debug, Clone, Serialize)]
pub struct TerminalOutput {
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TerminalStarted {
    pub cwd: String,
    pub log_file: String,
    pub reused: bool,
    pub snapshot: Vec<u8>,
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
    #[cfg(target_os = "windows")]
    {
        let _ = (commands, window, _app);
        return Err("[ERR_PLATFORM_UNSUPPORTED] One-shot PTY runner is not yet available on Windows. The macOS implementation invokes /bin/zsh -c <script>; needs a cmd.exe / pwsh equivalent before this can run.".to_string());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let mut cmd_builder = CommandBuilder::new("/bin/zsh");
        let script = commands
            .iter()
            .map(|c| c.cmd.clone())
            .collect::<Vec<_>>()
            .join(" && ");
        cmd_builder.arg("-c");
        cmd_builder.arg(&script);

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
}

#[tauri::command]
pub fn terminal_start(
    app: AppHandle,
    state: State<'_, WenmeiState>,
    rows: u16,
    cols: u16,
    force_restart: Option<bool>,
) -> Result<TerminalStarted, String> {
    #[cfg(target_os = "windows")]
    {
        let _ = (app, state, rows, cols, force_restart);
        return Err("[ERR_PLATFORM_UNSUPPORTED] Embedded terminal is not yet available on Windows. The macOS bootstrap script (zsh + Pi launch) needs a cmd.exe / pwsh equivalent.".to_string());
    }
    #[cfg(not(target_os = "windows"))]
    {
    let ctx = active_terminal_context(&state)?;
    let cwd = ctx.cwd.clone();
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
                    cwd: session.cwd.clone(),
                    log_file: session.log_file.clone(),
                    reused: true,
                    snapshot: session.backlog.lock().unwrap().clone(),
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

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let boot_script = terminal_boot_script(&cwd, &log_file, &pi_session_dir);
    let mut cmd = CommandBuilder::new(shell);
    cmd.arg("-l");
    cmd.arg("-c");
    cmd.arg(boot_script);
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env(
        "LANG",
        std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string()),
    );
    cmd.env(
        "LC_CTYPE",
        std::env::var("LC_CTYPE").unwrap_or_else(|_| "UTF-8".to_string()),
    );

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let master: Arc<Mutex<Box<dyn MasterPty + Send>>> = Arc::new(Mutex::new(pair.master));
    let child = Arc::new(Mutex::new(child));
    let backlog = Arc::new(Mutex::new(Vec::<u8>::new()));

    {
        let mut current = state.terminal.lock().unwrap();
        *current = Some(TerminalSession {
            writer: Arc::new(Mutex::new(writer)),
            child,
            master: master.clone(),
            cwd: desired_cwd.clone(),
            log_file: desired_log_file.clone(),
            backlog: backlog.clone(),
        });
    }

    let app_for_read = app.clone();
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
                    let _ = app_for_read.emit("terminal-output", TerminalOutput { data });
                }
                Err(e) => {
                    let _ = app_for_read.emit(
                        "terminal-output",
                        TerminalOutput {
                            data: format!("\r\n[Wenmei terminal read error: {}]\r\n", e)
                                .into_bytes(),
                        },
                    );
                    break;
                }
            }
        }
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
        cwd: desired_cwd,
        log_file: desired_log_file,
        reused: false,
        snapshot: vec![],
    })
    }
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
