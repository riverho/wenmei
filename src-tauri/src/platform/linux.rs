use portable_pty::CommandBuilder;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command as ProcessCommand;
use tauri::AppHandle;

use crate::cli::find_bundled_script;
use crate::state::shell_quote;

pub struct LinuxPlatform;

impl crate::platform::Platform for LinuxPlatform {
    fn reveal_in_folder(path: &Path) -> Result<(), String> {
        let parent = path.parent().unwrap_or(path);
        ProcessCommand::new("xdg-open")
            .arg(&parent.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn install_cli(app: &AppHandle) -> Result<String, String> {
        let shim = find_bundled_script(app, "wenmei")?;
        let dest = PathBuf::from("/usr/local/bin/wenmei");

        fs::create_dir_all("/usr/local/bin")
            .map_err(|e| format!("Failed to create /usr/local/bin: {}", e))?;
        fs::copy(&shim, &dest).map_err(|e| format!("Failed to copy shim: {}", e))?;

        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dest, fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to set permissions: {}", e))?;

        Ok(format!(
            "Installed wenmei CLI to {}",
            dest.to_string_lossy()
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
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let boot_script = terminal_boot_script(cwd, log_file, pi_session_dir);
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l");
        cmd.arg("-c");
        cmd.arg(boot_script);
        cmd
    }

    fn build_pty_command(commands: &[String]) -> CommandBuilder {
        let script = commands.join(" && ");
        let mut cmd = CommandBuilder::new("/bin/bash");
        cmd.arg("-c");
        cmd.arg(&script);
        cmd
    }

    fn pi_fallback_paths() -> Vec<PathBuf> {
        let mut candidates = vec![PathBuf::from("/usr/local/bin/pi")];
        if let Some(user_bin) = pi_user_bin() {
            candidates.push(user_bin.join("pi"));
        }
        candidates
    }

    fn pi_process_path() -> String {
        let mut parts: Vec<String> = vec!["/usr/local/bin".to_string()];
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
        // No-op on Linux.
    }

    fn pi_not_found_error() -> String {
        "Global Pi executable not found. Expected /usr/local/bin/pi or ~/.pi/agent/bin/pi. Install/configure Pi globally first.".to_string()
    }

    fn handle_run_event(_app: &AppHandle, _event: tauri::RunEvent) {
        // No-op on Linux.
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
  exec ${{SHELL:-/bin/bash}} -l
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
    echo ''
    echo 'Original error was saved to:'
    echo "  $LOG_FILE"
    echo ''
    log 'blocked pi: pi --version failed in sandbox'
    /bin/echo '--- pi preflight stderr ---' >> "$LOG_FILE" 2>/dev/null || true
    /bin/cat "$PI_PREFLIGHT" >> "$LOG_FILE" 2>/dev/null || true
    /bin/echo '--- end pi preflight stderr ---' >> "$LOG_FILE" 2>/dev/null || true
    /bin/rm -f "$PI_PREFLIGHT" 2>/dev/null || true
    exec ${{SHELL:-/bin/bash}} -l
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
exec ${{SHELL:-/bin/bash}} -l
"#,
        sandbox_dir = shell_quote(&cwd.to_string_lossy()),
        log_file = shell_quote(&log_file.to_string_lossy()),
        pi_session_dir = shell_quote(&pi_session_dir.to_string_lossy())
    )
}
