use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

use crate::platform::Platform;

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
    let version = path
        .as_ref()
        .and_then(|p| crate::platform::Current::probe_cli_version(p));

    CliStatus {
        installed: path.is_some(),
        path,
        version,
    }
}

#[allow(dead_code)]
pub(crate) fn find_bundled_script(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
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
    crate::platform::Current::install_cli(&app)
}

#[tauri::command]
pub fn run_install_script(script_name: String, app: AppHandle) -> Result<String, String> {
    const ALLOWED: &[&str] = &[
        "install.sh",
        "install-cli.sh",
        "install-finder-service.sh",
        "install-quicklook.sh",
        "verify.sh",
    ];
    if !ALLOWED.contains(&script_name.as_str()) {
        return Err(format!(
            "[ERR_SCRIPT_DENIED] '{}' is not an allowed install script",
            script_name
        ));
    }
    crate::platform::Current::run_install_script(&script_name, &app)
}
