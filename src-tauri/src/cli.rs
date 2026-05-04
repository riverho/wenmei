use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command as ProcessCommand;
use tauri::{AppHandle, Manager};

use crate::state::shell_quote;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[tauri::command]
pub fn cli_integration_status() -> CliStatus {
    let path = which::which("wenmei")
        .ok()
        .map(|p| p.to_string_lossy().to_string());
    let version = path.as_ref().and_then(|p| {
        let output = std::process::Command::new(p)
            .arg("--version")
            .output()
            .ok()?;
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
    });
    CliStatus {
        installed: path.is_some(),
        path,
        version,
    }
}

fn find_bundled_script(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let base = app.path().resource_dir().map_err(|e| e.to_string())?;
    let candidates = [
        base.join("_up_").join("scripts").join(name),
        base.join("scripts").join(name),
        base.join(name),
    ];
    candidates
        .iter()
        .find(|p| p.exists())
        .cloned()
        .ok_or_else(|| format!("bundled script not found: {}", name))
}

#[tauri::command]
pub fn install_cli_integration(app: AppHandle) -> Result<String, String> {
    let shim = find_bundled_script(&app, "wenmei")?;
    let finder = find_bundled_script(&app, "install-finder-service.sh")?;

    let dest = PathBuf::from("/usr/local/bin/wenmei");

    let direct_ok = || -> Result<(), std::io::Error> {
        std::fs::create_dir_all("/usr/local/bin")?;
        std::fs::copy(&shim, &dest)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755))?;
        }
        #[cfg(not(unix))]
        {
            let mut perms = std::fs::metadata(&dest)?.permissions();
            #[allow(clippy::permissions_set_readonly_false)]
            perms.set_readonly(false);
            std::fs::set_permissions(&dest, perms)?;
        }
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

#[tauri::command]
pub fn run_install_script(script_name: String, app: AppHandle) -> Result<String, String> {
    let script = find_bundled_script(&app, &script_name)?;
    let output = ProcessCommand::new("bash")
        .arg(&script)
        .output()
        .map_err(|e| format!("failed to run {}: {}", script_name, e))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
