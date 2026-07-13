use portable_pty::CommandBuilder;
use std::path::{Path, PathBuf};
use std::process::Command as ProcessCommand;
use tauri::AppHandle;

pub struct WindowsPlatform;

impl crate::platform::Platform for WindowsPlatform {
    fn reveal_in_folder(path: &Path) -> Result<(), String> {
        use std::os::windows::process::CommandExt;
        ProcessCommand::new("explorer")
            .args(["/select,", &path.to_string_lossy()])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn install_cli(_app: &AppHandle) -> Result<String, String> {
        let exe = std::env::current_exe()
            .map_err(|e| format!("Cannot locate Wenmei executable: {}", e))?;
        let exe_dir = exe
            .parent()
            .ok_or_else(|| "Cannot determine executable directory".to_string())?;
        let cmd_path = exe_dir.join("wenmei.cmd");
        let content = format!(
            "@echo off\r\nstart \"\" \"{}\" %*\r\n",
            exe.to_string_lossy()
        );
        std::fs::write(&cmd_path, content)
            .map_err(|e| format!("Failed to write wenmei.cmd: {}", e))?;
        let dir = exe_dir.to_string_lossy();
        Ok(format!(
            "Created wenmei.cmd at {}.\n\nTo use it from any terminal, add this directory to your PATH:\n  $env:PATH = \"{};$env:PATH\"\n\nThe MSI installer does this automatically.",
            cmd_path.to_string_lossy(),
            dir
        ))
    }

    fn run_install_script(_name: &str, _app: &AppHandle) -> Result<String, String> {
        Err("[ERR_PLATFORM_UNSUPPORTED] Install scripts are bash-based and not available on Windows.".to_string())
    }

    fn probe_cli_version(_path: &str) -> Option<String> {
        // On Windows the CLI shim is a .cmd that launches the GUI app rather than
        // printing a version string. Calling it would spawn a new Wenmei window, so
        // we skip the probe entirely and return None for version.
        None
    }

    fn build_terminal_command(
        raw_cwd: &Path,
        terminal_cwd: &Path,
        log_file: &Path,
        pi_session_dir: &Path,
    ) -> CommandBuilder {
        let boot_script =
            terminal_boot_script_windows(raw_cwd, terminal_cwd, log_file, pi_session_dir);
        let encoded = encode_powershell_command(&boot_script);
        let shell = find_windows_shell();
        let mut cmd = CommandBuilder::new(shell);
        cmd.arg("-NoProfile");
        cmd.arg("-NoExit");
        cmd.arg("-EncodedCommand");
        cmd.arg(&encoded);
        cmd
    }

    fn terminal_cwd(cwd: &Path) -> PathBuf {
        PathBuf::from(normalize_windows_cwd_string_for_shell(
            &cwd.to_string_lossy(),
        ))
    }

    fn build_pty_command(commands: &[String]) -> CommandBuilder {
        let script = commands.join("; ");
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.arg("-NoProfile");
        cmd.arg("-Command");
        cmd.arg(&script);
        cmd
    }

    fn pi_fallback_paths() -> Vec<PathBuf> {
        // Windows relies entirely on PATH search via `which`.
        vec![]
    }

    fn pi_process_path() -> String {
        std::env::var("PATH").unwrap_or_default()
    }

    fn pi_spawn_flags(cmd: &mut ProcessCommand) {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    fn pi_not_found_error() -> String {
        "Global Pi executable not found. Install Pi (npm install -g @mariozechner/pi-coding-agent) and ensure pi.cmd / pi.exe is on PATH.".to_string()
    }

    fn handle_run_event(_app: &AppHandle, _event: tauri::RunEvent) {
        // No-op on Windows.
    }
}

fn ps1_escape(s: &str) -> String {
    s.replace('\'', "''")
}

fn terminal_boot_script_windows(
    raw_cwd: &Path,
    terminal_cwd: &Path,
    log_file: &Path,
    _pi_session_dir: &Path,
) -> String {
    // Land the tab in an interactive PowerShell at the sandbox cwd (the shell is
    // launched with -NoExit, so the prompt stays after this script). Pi is no
    // longer auto-launched — run `pi` yourself when you want the agent.
    let raw_sandbox = ps1_escape(&raw_cwd.to_string_lossy());
    let sandbox = ps1_escape(&terminal_cwd.to_string_lossy());
    let log = ps1_escape(&log_file.to_string_lossy());
    format!(
        r#"$RAW_SANDBOX_DIR = '{raw_sandbox}'
$SANDBOX_DIR = '{sandbox}'
$LOG_FILE = '{log}'
$ErrorActionPreference = 'SilentlyContinue'
function wenmei_log {{
    param([string]$msg)
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $dir = Split-Path $LOG_FILE -Parent
    if ($dir) {{ New-Item -ItemType Directory -Force -Path $dir | Out-Null }}
    Add-Content -Path $LOG_FILE -Value "[$ts] $msg"
}}
Clear-Host
Write-Host 'Wenmei sandbox:'
Write-Host $SANDBOX_DIR
Write-Host ''
wenmei_log "embedded terminal opening raw_cwd=$RAW_SANDBOX_DIR terminal_cwd=$SANDBOX_DIR"
try {{
    Set-Location -LiteralPath $SANDBOX_DIR -ErrorAction Stop
}} catch {{
    Write-Host 'Wenmei cannot enter this sandbox folder.'
    Write-Host "Reason: $($_.Exception.Message)"
    Write-Host "Log: $LOG_FILE"
    wenmei_log "cd failed: $($_.Exception.Message)"
}}
"#,
        raw_sandbox = raw_sandbox,
        sandbox = sandbox,
        log = log,
    )
}

fn normalize_windows_cwd_string_for_shell(cwd: &str) -> String {
    if let Some(rest) = cwd.strip_prefix("\\\\?\\UNC\\") {
        return format!("\\\\{}", rest);
    }

    if let Some(rest) = cwd.strip_prefix("\\\\?\\") {
        let bytes = rest.as_bytes();
        if bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && bytes[2] == b'\\'
        {
            return rest.to_string();
        }
    }

    cwd.to_string()
}

// PowerShell -EncodedCommand requires Base64-encoded UTF-16LE. This avoids
// any quoting issues passing the boot script on the command line.
fn encode_powershell_command(script: &str) -> String {
    let bytes: Vec<u8> = script
        .encode_utf16()
        .flat_map(|u| u.to_le_bytes())
        .collect();
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() * 4 + 2) / 3);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            T[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

fn find_windows_shell() -> &'static str {
    if which::which("pwsh").is_ok() {
        "pwsh"
    } else {
        "powershell.exe"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_extended_drive_path_for_shell() {
        assert_eq!(
            normalize_windows_cwd_string_for_shell("\\\\?\\D:\\GEO-website"),
            "D:\\GEO-website"
        );
        assert_eq!(
            normalize_windows_cwd_string_for_shell("\\\\?\\D:\\GEO-website\\"),
            "D:\\GEO-website\\"
        );
    }

    #[test]
    fn normalizes_extended_unc_path_for_shell() {
        assert_eq!(
            normalize_windows_cwd_string_for_shell("\\\\?\\UNC\\server\\share\\folder"),
            "\\\\server\\share\\folder"
        );
    }

    #[test]
    fn leaves_shell_safe_windows_paths_unchanged() {
        assert_eq!(
            normalize_windows_cwd_string_for_shell("D:\\GEO-website"),
            "D:\\GEO-website"
        );
        assert_eq!(
            normalize_windows_cwd_string_for_shell("\\\\server\\share\\folder"),
            "\\\\server\\share\\folder"
        );
    }

    #[test]
    fn boot_script_logs_raw_and_terminal_cwd_and_uses_literal_path() {
        let script = terminal_boot_script_windows(
            Path::new("\\\\?\\D:\\GEO-website"),
            Path::new("D:\\GEO-website"),
            Path::new("C:\\Users\\RH\\AppData\\Roaming\\Wenmei\\terminal.log"),
            Path::new("D:\\GEO-website\\.wenmei\\pi-sessions\\sandbox\\terminal"),
        );

        assert!(script.contains("$RAW_SANDBOX_DIR = '\\\\?\\D:\\GEO-website'"));
        assert!(script.contains("$SANDBOX_DIR = 'D:\\GEO-website'"));
        assert!(script.contains(
            "embedded terminal opening raw_cwd=$RAW_SANDBOX_DIR terminal_cwd=$SANDBOX_DIR"
        ));
        assert!(script.contains("Set-Location -LiteralPath $SANDBOX_DIR -ErrorAction Stop"));
    }
}
