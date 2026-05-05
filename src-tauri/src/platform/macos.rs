use portable_pty::CommandBuilder;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command as ProcessCommand;
use tauri::{AppHandle, Emitter, Manager};

use crate::cli::find_bundled_script;
use crate::state::{save_state, shell_quote, Vault, WenmeiState};

pub struct MacosPlatform;

impl crate::platform::Platform for MacosPlatform {
    fn reveal_in_folder(path: &Path) -> Result<(), String> {
        ProcessCommand::new("open")
            .args(["-R", &path.to_string_lossy()])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn install_cli(app: &AppHandle) -> Result<String, String> {
        let shim = find_bundled_script(app, "wenmei")?;
        let finder = find_bundled_script(app, "install-finder-service.sh")?;
        let dest = PathBuf::from("/usr/local/bin/wenmei");

        let direct_ok = || -> Result<(), std::io::Error> {
            fs::create_dir_all("/usr/local/bin")?;
            fs::copy(&shim, &dest)?;
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dest, fs::Permissions::from_mode(0o755))?;
            Ok(())
        };

        let used_sudo = match direct_ok() {
            Ok(()) => false,
            Err(e) => {
                eprintln!("Direct install failed (will try admin dialog): {}", e);
                let shell_cmd = format!(
                    "mkdir -p /usr/local/bin && cp {src} /usr/local/bin/wenmei && chmod +x /usr/local/bin/wenmei",
                    src = shell_quote(&shim.to_string_lossy()),
                );
                let osa = format!(
                    "do shell script \"{}\" with administrator privileges",
                    shell_cmd.replace('\\', "\\\\").replace('"', "\\\"")
                );
                let cli_status = ProcessCommand::new("osascript")
                    .arg("-e")
                    .arg(&osa)
                    .status()
                    .map_err(|e| format!("osascript failed: {}", e))?;
                if !cli_status.success() {
                    return Err("CLI install was cancelled or failed".into());
                }
                true
            }
        };

        let finder_status = ProcessCommand::new("bash")
            .arg(&finder)
            .status()
            .map_err(|e| format!("Finder service installer failed: {}", e))?;
        if !finder_status.success() {
            return Err("Finder service installer exited non-zero".into());
        }

        let method = if used_sudo {
            "via admin dialog"
        } else {
            "directly"
        };
        Ok(format!(
            "Installed wenmei CLI {} to /usr/local/bin and Finder service to ~/Library/Services",
            method
        ))
    }

    fn run_install_script(name: &str, app: &AppHandle) -> Result<String, String> {
        let script = find_bundled_script(app, name)?;
        let output = ProcessCommand::new("bash")
            .arg(&script)
            .output()
            .map_err(|e| format!("failed to run {}: {}", name, e))?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }

    fn probe_cli_version(path: &str) -> Option<String> {
        let output = ProcessCommand::new(path).arg("--version").output().ok()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let text = if stdout.trim().is_empty() {
            stderr
        } else {
            stdout
        };
        let text = text.trim();
        if text.is_empty() {
            None
        } else {
            Some(text.to_string())
        }
    }

    fn build_terminal_command(
        cwd: &Path,
        log_file: &Path,
        pi_session_dir: &Path,
    ) -> CommandBuilder {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let boot_script = terminal_boot_script(cwd, log_file, pi_session_dir);
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l");
        cmd.arg("-c");
        cmd.arg(boot_script);
        cmd
    }

    fn build_pty_command(commands: &[String]) -> CommandBuilder {
        let script = commands.join(" && ");
        let mut cmd = CommandBuilder::new("/bin/zsh");
        cmd.arg("-c");
        cmd.arg(&script);
        cmd
    }

    fn pi_fallback_paths() -> Vec<PathBuf> {
        let mut candidates = vec![
            PathBuf::from("/usr/local/bin/pi"),
            PathBuf::from("/opt/homebrew/bin/pi"),
        ];
        if let Some(user_bin) = pi_user_bin() {
            candidates.push(user_bin.join("pi"));
        }
        candidates
    }

    fn pi_process_path() -> String {
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

    fn pi_spawn_flags(_cmd: &mut ProcessCommand) {
        // No-op on macOS.
    }

    fn pi_not_found_error() -> String {
        "Global Pi executable not found. Expected /usr/local/bin/pi, /opt/homebrew/bin/pi, or ~/.pi/agent/bin/pi. Install/configure Pi globally first.".to_string()
    }

    fn handle_run_event(app_handle: &AppHandle, event: tauri::RunEvent) {
        if let tauri::RunEvent::Opened { urls } = event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let path_str = path.to_string_lossy().to_string();

                    let mut needs_save = false;
                    let (emit_path, is_inside_vault) = if let Some(state) =
                        app_handle.try_state::<WenmeiState>()
                    {
                        if let Ok(mut app_state) = state.app_state.lock() {
                            let found = app_state.vaults.iter().find_map(|vault| {
                                let vault_path = PathBuf::from(&vault.path);
                                path.strip_prefix(&vault_path).ok().map(|rel| (vault, rel))
                            });

                            if let Some((_vault, rel)) = found {
                                let rel_str = rel.to_string_lossy();
                                (format!("/{}", rel_str), true)
                            } else {
                                let parent = path.parent().unwrap_or(&path);
                                let parent_str = parent.to_string_lossy().to_string();
                                let vault_path_str = parent_str.clone();

                                let id =
                                    format!("vault-{}", chrono::Local::now().timestamp_millis());
                                let name = parent
                                    .file_name()
                                    .and_then(|n| n.to_str())
                                    .unwrap_or("Vault")
                                    .to_string();

                                let vault = Vault {
                                    id: id.clone(),
                                    name,
                                    path: vault_path_str.clone(),
                                    is_active: true,
                                };

                                for v in &mut app_state.vaults {
                                    v.is_active = false;
                                }
                                app_state.vaults.push(vault.clone());
                                app_state.active_vault_id = id.clone();
                                needs_save = true;

                                let meta_root = PathBuf::from(&vault_path_str).join(".wenmei");
                                let _ = fs::create_dir_all(meta_root.join("terminal").join("logs"));
                                let _ = fs::create_dir_all(
                                    meta_root
                                        .join("pi-sessions")
                                        .join("default-root")
                                        .join("terminal"),
                                );
                                let _ = fs::create_dir_all(
                                    meta_root
                                        .join("pi-sessions")
                                        .join("default-root")
                                        .join("panel"),
                                );
                                let _ = fs::create_dir_all(meta_root.join("trash"));

                                let _ = app_handle.emit(
                                    "app-error",
                                    serde_json::json!({
                                        "code": "AUTO_VAULT_CREATED",
                                        "component": "run_event",
                                        "vault_path": vault_path_str,
                                        "message": format!("Created vault from '{}' and opening file.", path.file_name().and_then(|n| n.to_str()).unwrap_or(&path_str)),
                                        "timestamp": chrono::Utc::now().to_rfc3339(),
                                    }),
                                );

                                let rel_path = path.strip_prefix(parent).unwrap_or(&path);
                                let rel_str = rel_path.to_string_lossy();
                                (format!("/{}", rel_str), true)
                            }
                        } else {
                            (path_str.clone(), false)
                        }
                    } else {
                        (path_str.clone(), false)
                    };

                    if is_inside_vault {
                        if let Some(state) = app_handle.try_state::<WenmeiState>() {
                            if let Ok(mut initial_file) = state.initial_file.lock() {
                                *initial_file = Some(emit_path.clone());
                            }
                        }
                    }

                    if needs_save {
                        if let Some(state) = app_handle.try_state::<WenmeiState>() {
                            let _ = save_state(&state);
                        }
                    }

                    let _ = app_handle.emit("os-file-opened", emit_path);
                }
            }
        }
    }
}

fn pi_user_bin() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".pi").join("agent").join("bin"))
}

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
