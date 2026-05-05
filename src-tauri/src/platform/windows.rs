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
        cwd: &Path,
        log_file: &Path,
        pi_session_dir: &Path,
    ) -> CommandBuilder {
        let boot_script = terminal_boot_script_windows(cwd, log_file, pi_session_dir);
        let encoded = encode_powershell_command(&boot_script);
        let shell = find_windows_shell();
        let mut cmd = CommandBuilder::new(shell);
        cmd.arg("-NoProfile");
        cmd.arg("-NoExit");
        cmd.arg("-EncodedCommand");
        cmd.arg(&encoded);
        cmd
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

fn terminal_boot_script_windows(cwd: &Path, log_file: &Path, pi_session_dir: &Path) -> String {
    let sandbox = ps1_escape(&cwd.to_string_lossy());
    let log = ps1_escape(&log_file.to_string_lossy());
    let pi_sess = ps1_escape(&pi_session_dir.to_string_lossy());
    format!(
        r#"$SANDBOX_DIR = '{sandbox}'
$LOG_FILE = '{log}'
$PI_SESSION_DIR = '{pi_sess}'
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
wenmei_log "embedded terminal opening cwd=$SANDBOX_DIR"
try {{
    Set-Location -Path $SANDBOX_DIR -ErrorAction Stop
}} catch {{
    Write-Host 'Wenmei cannot enter this sandbox folder.'
    Write-Host "Reason: $($_.Exception.Message)"
    Write-Host "Log: $LOG_FILE"
    wenmei_log "cd failed: $($_.Exception.Message)"
    return
}}
$pi = Get-Command pi -ErrorAction SilentlyContinue
if ($pi) {{
    New-Item -ItemType Directory -Force -Path $PI_SESSION_DIR | Out-Null
    $piVer = (& pi --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {{
        Write-Host 'Wenmei blocked Pi before it crashed.'
        Write-Host ''
        Write-Host 'Global Pi cannot start in this sandbox cwd.'
        Write-Host ''
        Write-Host "Log: $LOG_FILE"
        wenmei_log 'blocked pi: pi --version failed in sandbox'
        Add-Content -Path $LOG_FILE -Value '--- pi preflight stderr ---'
        Add-Content -Path $LOG_FILE -Value $piVer
        Add-Content -Path $LOG_FILE -Value '--- end pi preflight stderr ---'
        return
    }}
    wenmei_log "starting pi version=$piVer session_dir=$PI_SESSION_DIR"
    & pi --session-dir $PI_SESSION_DIR --continue
    if ($LASTEXITCODE -ne 0) {{ & pi --session-dir $PI_SESSION_DIR }}
    wenmei_log "pi exited code=$LASTEXITCODE"
}} else {{
    Write-Host 'Pi not found. Configure global Pi first:'
    Write-Host '  npm install -g @mariozechner/pi-coding-agent'
    wenmei_log 'pi not found'
}}
Write-Host ''
Write-Host 'Exited Pi. Shell remains in Wenmei sandbox.'
"#,
        sandbox = sandbox,
        log = log,
        pi_sess = pi_sess,
    )
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
