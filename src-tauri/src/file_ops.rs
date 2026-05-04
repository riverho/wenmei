use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, State};

use crate::journal::{append_journal_event, emit_files_changed};
use crate::state::{
    active_vault, log_action, relative_path, save_state, AppState, FileContent, FileNode, Vault,
    WenmeiState,
};

fn reject_unsafe_rel(path: &str) -> Result<PathBuf, String> {
    let normalized = path.trim().trim_start_matches('/');
    let rel = PathBuf::from(normalized);
    if rel.is_absolute() {
        return Err("[ERR_UNSAFE_PATH] Absolute paths are not allowed inside a vault".to_string());
    }
    for component in rel.components() {
        match component {
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                return Err("[ERR_VAULT_ESCAPE] Path escapes the active vault".to_string());
            }
            _ => {}
        }
    }
    Ok(rel)
}

fn ensure_inside_vault(vault_root: &Path, full: &Path) -> Result<(), String> {
    let canonical_root = fs::canonicalize(vault_root)
        .map_err(|e| format!("[ERR_VAULT_ESCAPE] cannot resolve vault root: {}", e))?;
    let mut probe = full.to_path_buf();
    while !probe.exists() {
        match probe.parent() {
            Some(parent) if parent != probe.as_path() => probe = parent.to_path_buf(),
            _ => return Err("[ERR_VAULT_ESCAPE] path has no existing ancestor".to_string()),
        }
    }
    let canonical = fs::canonicalize(&probe)
        .map_err(|e| format!("[ERR_VAULT_ESCAPE] cannot canonicalize: {}", e))?;
    if !canonical.starts_with(&canonical_root) {
        return Err("[ERR_VAULT_ESCAPE] Path escapes the active vault".to_string());
    }
    Ok(())
}

pub fn resolve_path(vault: &Vault, rel: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(&vault.path);
    let full = root.join(reject_unsafe_rel(rel)?);
    ensure_inside_vault(&root, &full)?;
    Ok(full)
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn build_tree_recursive(dir: &Path, workspace: &Path, state: &AppState) -> Vec<FileNode> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    let mut collected: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    collected.sort_by(|a, b| {
        let a_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let b_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        match (a_dir, b_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name().cmp(&b.file_name()),
        }
    });

    let mut nodes = vec![];
    for entry in collected {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }

        let full_path = entry.path();
        let rel = relative_path(&full_path, workspace);
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let modified_at = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .map(|t| {
                let datetime: chrono::DateTime<chrono::Local> = t.into();
                datetime.format("%Y-%m-%d %H:%M").to_string()
            });

        if is_dir {
            nodes.push(FileNode {
                id: rel.clone(),
                name,
                path: rel,
                node_type: "folder".to_string(),
                children: Some(build_tree_recursive(&full_path, workspace, state)),
                is_pinned: false,
                is_recent: false,
                modified_at,
            });
        } else {
            nodes.push(FileNode {
                id: rel.clone(),
                name,
                path: rel.clone(),
                node_type: "file".to_string(),
                children: None,
                is_pinned: state.pinned_files.contains(&rel),
                is_recent: state.recent_files.contains(&rel),
                modified_at,
            });
        }
    }
    nodes
}

fn unique_child(parent: &Path, name: &str) -> PathBuf {
    let mut candidate = parent.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(name);
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    for i in 1..1000 {
        let next = if ext.is_empty() {
            format!("{}-{}", stem, i)
        } else {
            format!("{}-{}.{}", stem, i, ext)
        };
        candidate = parent.join(next);
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!("{}-copy", name))
}

#[tauri::command]
pub fn list_files(state: State<'_, WenmeiState>) -> Result<Vec<FileNode>, String> {
    let vault = active_vault(&state)?;
    let workspace = PathBuf::from(&vault.path);
    let app_state = state.app_state.lock().unwrap().clone();
    Ok(build_tree_recursive(&workspace, &workspace, &app_state))
}

#[tauri::command]
pub fn read_file(path: String, state: State<'_, WenmeiState>) -> Result<FileContent, String> {
    let vault = active_vault(&state)?;
    let full_path = resolve_path(&vault, &path)?;
    let content =
        fs::read_to_string(&full_path).map_err(|e| format!("Failed to read file: {}", e))?;
    let name = full_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("untitled")
        .to_string();

    {
        let mut app_state = state.app_state.lock().unwrap();
        app_state.last_active_file = Some(path.clone());
        app_state.recent_files.retain(|p| p != &path);
        app_state.recent_files.insert(0, path.clone());
        app_state.recent_files.truncate(10);
    }
    save_state(&state)?;
    Ok(FileContent {
        path,
        content,
        name,
    })
}

#[tauri::command]
pub fn write_file(
    path: String,
    content: String,
    app: AppHandle,
    state: State<'_, WenmeiState>,
) -> Result<(), String> {
    let vault = active_vault(&state)?;
    let full_path = resolve_path(&vault, &path)?;
    ensure_parent(&full_path)?;
    fs::write(&full_path, content).map_err(|e| format!("Failed to write file: {}", e))?;
    log_action(&state, format!("wrote {}", path));
    let _ = append_journal_event(
        &state,
        "file.updated",
        "file-panel",
        Some(path.clone()),
        format!("Updated {}", path),
        serde_json::json!({}),
    );
    emit_files_changed(&app, "file.updated");
    save_state(&state)
}

#[tauri::command]
pub fn create_file(
    parent_path: String,
    name: String,
    app: AppHandle,
    state: State<'_, WenmeiState>,
) -> Result<String, String> {
    let vault = active_vault(&state)?;
    let parent = resolve_path(&vault, &parent_path)?;
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let full_path = unique_child(&parent, &name);
    fs::write(&full_path, "").map_err(|e| format!("Failed to create file: {}", e))?;
    let rel = relative_path(&full_path, &PathBuf::from(&vault.path));
    log_action(&state, format!("created {}", rel));
    let _ = append_journal_event(
        &state,
        "file.created",
        "file-panel",
        Some(rel.clone()),
        format!("Created {}", rel),
        serde_json::json!({}),
    );
    emit_files_changed(&app, "file.created");
    save_state(&state)?;
    Ok(rel)
}

#[tauri::command]
pub fn create_folder(
    parent_path: String,
    name: String,
    app: AppHandle,
    state: State<'_, WenmeiState>,
) -> Result<String, String> {
    let vault = active_vault(&state)?;
    let parent = resolve_path(&vault, &parent_path)?;
    let full_path = unique_child(&parent, &name);
    fs::create_dir_all(&full_path).map_err(|e| format!("Failed to create folder: {}", e))?;
    let rel = relative_path(&full_path, &PathBuf::from(&vault.path));
    log_action(&state, format!("created folder {}", rel));
    let _ = append_journal_event(
        &state,
        "file.created",
        "file-panel",
        Some(rel.clone()),
        format!("Created folder {}", rel),
        serde_json::json!({"folder": true}),
    );
    emit_files_changed(&app, "file.created");
    save_state(&state)?;
    Ok(rel)
}

#[tauri::command]
pub fn rename_file(
    old_path: String,
    new_name: String,
    app: AppHandle,
    state: State<'_, WenmeiState>,
) -> Result<String, String> {
    let vault = active_vault(&state)?;
    let old_full = resolve_path(&vault, &old_path)?;
    let parent = old_full
        .parent()
        .ok_or_else(|| "Invalid file path".to_string())?;
    let new_full = unique_child(parent, &new_name);
    fs::rename(&old_full, &new_full).map_err(|e| format!("Failed to rename: {}", e))?;
    let rel = relative_path(&new_full, &PathBuf::from(&vault.path));
    {
        let mut app_state = state.app_state.lock().unwrap();
        if app_state.last_active_file.as_ref() == Some(&old_path) {
            app_state.last_active_file = Some(rel.clone());
        }
        app_state.pinned_files.retain(|p| p != &old_path);
        app_state.recent_files.retain(|p| p != &old_path);
    }
    log_action(&state, format!("renamed {} to {}", old_path, rel));
    let _ = append_journal_event(
        &state,
        "file.renamed",
        "file-panel",
        Some(rel.clone()),
        format!("Renamed {} to {}", old_path, rel),
        serde_json::json!({"from": old_path}),
    );
    emit_files_changed(&app, "file.renamed");
    save_state(&state)?;
    Ok(rel)
}

#[tauri::command]
pub fn delete_file(path: String, app: AppHandle, state: State<'_, WenmeiState>) -> Result<(), String> {
    let vault = active_vault(&state)?;
    let full_path = resolve_path(&vault, &path)?;
    if !full_path.exists() {
        return Err("File does not exist".to_string());
    }
    let metadata_mode = state.app_state.lock().unwrap().metadata_mode.clone();
    let trash_dir = if metadata_mode == "local" {
        crate::state::init_vault_meta(Path::new(&vault.path));
        PathBuf::from(&vault.path).join(".wenmei").join("trash")
    } else {
        state
            .registry_file
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("trash")
            .join(crate::state::safe_meta_name(&vault.id))
    };
    fs::create_dir_all(&trash_dir).map_err(|e| e.to_string())?;
    let name = full_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("deleted");
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let target = unique_child(&trash_dir, &format!("{}-{}", ts, name));
    fs::rename(&full_path, &target).map_err(|e| format!("Failed to move to trash: {}", e))?;
    {
        let mut app_state = state.app_state.lock().unwrap();
        if app_state.last_active_file.as_ref() == Some(&path) {
            app_state.last_active_file = None;
        }
        app_state.pinned_files.retain(|p| p != &path);
        app_state.recent_files.retain(|p| p != &path);
    }
    log_action(&state, format!("moved {} to vault trash", path));
    let _ = append_journal_event(
        &state,
        "file.deleted",
        "file-panel",
        Some(path.clone()),
        format!("Moved {} to vault trash", path),
        serde_json::json!({"trash": target.to_string_lossy()}),
    );
    emit_files_changed(&app, "file.deleted");
    save_state(&state)
}

#[tauri::command]
pub fn move_file(
    source: String,
    target_folder: String,
    app: AppHandle,
    state: State<'_, WenmeiState>,
) -> Result<String, String> {
    let vault = active_vault(&state)?;
    let source_full = resolve_path(&vault, &source)?;
    let target_dir = resolve_path(&vault, &target_folder)?;

    if !source_full.exists() {
        return Err("Source does not exist".to_string());
    }
    let source_parent = source_full
        .parent()
        .ok_or_else(|| "Invalid source".to_string())?;
    if source_parent == target_dir.as_path() {
        return Err("noop".to_string());
    }
    if source_full.is_dir() {
        let mut p: Option<&Path> = Some(target_dir.as_path());
        while let Some(cur) = p {
            if cur == source_full.as_path() {
                return Err("Cannot move folder into itself".to_string());
            }
            p = cur.parent();
        }
    }

    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let file_name = source_full
        .file_name()
        .ok_or_else(|| "Invalid source".to_string())?;
    let target_full = unique_child(&target_dir, &file_name.to_string_lossy());
    fs::rename(&source_full, &target_full).map_err(|e| format!("Failed to move: {}", e))?;
    let rel = relative_path(&target_full, &PathBuf::from(&vault.path));
    log_action(&state, format!("moved {} to {}", source, rel));
    let _ = append_journal_event(
        &state,
        "file.moved",
        "file-panel",
        Some(rel.clone()),
        format!("Moved {} to {}", source, rel),
        serde_json::json!({"from": source}),
    );
    emit_files_changed(&app, "file.moved");
    save_state(&state)?;
    Ok(rel)
}

#[tauri::command]
pub fn toggle_pin(path: String, state: State<'_, WenmeiState>) -> Result<bool, String> {
    let is_pinned = {
        let mut app_state = state.app_state.lock().unwrap();
        if app_state.pinned_files.contains(&path) {
            app_state.pinned_files.retain(|p| p != &path);
            false
        } else {
            app_state.pinned_files.push(path.clone());
            true
        }
    };
    log_action(
        &state,
        format!("{} {}", if is_pinned { "pinned" } else { "unpinned" }, path),
    );
    save_state(&state)?;
    Ok(is_pinned)
}

#[tauri::command]
pub fn get_pinned_files(state: State<'_, WenmeiState>) -> Result<Vec<String>, String> {
    Ok(state.app_state.lock().unwrap().pinned_files.clone())
}

#[tauri::command]
pub fn get_recent_files(state: State<'_, WenmeiState>) -> Result<Vec<String>, String> {
    Ok(state.app_state.lock().unwrap().recent_files.clone())
}

#[tauri::command]
pub fn copy_file_path(path: String, state: State<'_, WenmeiState>) -> Result<String, String> {
    let vault = active_vault(&state)?;
    Ok(resolve_path(&vault, &path)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn reveal_in_folder(path: String, state: State<'_, WenmeiState>) -> Result<(), String> {
    let vault = active_vault(&state)?;
    let full = resolve_path(&vault, &path)?;
    let _parent = full.parent().unwrap_or_else(|| Path::new(&vault.path));

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .args(["-R", &full.to_string_lossy()])
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .args(["/select,", &full.to_string_lossy()])
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&_parent.to_string_lossy().to_string())
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}
