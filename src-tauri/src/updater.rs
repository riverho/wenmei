use tauri_plugin_updater::UpdaterExt;

/// Check the release feed for a newer version. Returns the new version
/// string, or None when up to date. Errors mean "updates not configured"
/// (placeholder pubkey / no network) — the UI treats that as informational.
#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(Some(update.version.clone())),
        Ok(None) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
