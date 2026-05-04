use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::State;

use crate::file_ops::resolve_path;
use crate::state::{
    active_vault, active_vault_from_state, ensure_active_root_sandbox, load_registry,
    save_registry_file, upsert_registry_sandbox, ensure_active_workspace, init_vault_meta,
    save_state, log_action, AuthorizedSandbox, Sandbox, SandboxRegistry, Vault, WenmeiState,
};

#[derive(Serialize)]
pub struct EnsureDefaultVaultResult {
    pub is_new: bool,
    pub welcome_created: bool,
    pub vault_path: String,
    pub welcome_path: String,
}

const WELCOME_MD: &str = include_str!("../templates/Welcome.md");

#[tauri::command]
pub fn ensure_default_vault(state: State<'_, WenmeiState>) -> Result<EnsureDefaultVaultResult, String> {
    let docs =
        dirs::document_dir().ok_or_else(|| "Could not find Documents directory".to_string())?;
    let vault_path = docs.join("Wenmei");
    let welcome_path = vault_path.join("Welcome.md");
    let is_new = !vault_path.exists();
    let welcome_created = !welcome_path.exists();
    let vault_path_str = vault_path.to_string_lossy().to_string();

    fs::create_dir_all(&vault_path).map_err(|e| e.to_string())?;

    if welcome_created {
        fs::write(&welcome_path, WELCOME_MD).map_err(|e| e.to_string())?;
    }

    init_vault_meta(&vault_path);

    {
        let mut app_state = state.app_state.lock().unwrap();
        let vault_id = if let Some(existing) = app_state
            .vaults
            .iter()
            .find(|vault| vault.path == vault_path_str)
            .cloned()
        {
            existing.id
        } else {
            let id = if app_state.vaults.iter().any(|vault| vault.id == "default") {
                format!("vault-{}", chrono::Local::now().timestamp_millis())
            } else {
                "default".to_string()
            };
            app_state.vaults.push(Vault {
                id: id.clone(),
                name: "Wenmei".to_string(),
                path: vault_path_str.clone(),
                is_active: false,
            });
            id
        };

        for vault in &mut app_state.vaults {
            vault.is_active = vault.id == vault_id;
        }
        app_state.active_vault_id = vault_id.clone();
        app_state.last_active_file = Some("/Welcome.md".to_string());
        app_state.open_folders = vec!["/".to_string()];
        app_state.open_mode = "vault".to_string();
        app_state.metadata_mode = "local".to_string();
        app_state.sandbox_auth_status = "promoted".to_string();
        ensure_active_root_sandbox(&mut app_state, &vault_id);
    }

    save_state(&state)?;

    Ok(EnsureDefaultVaultResult {
        is_new,
        welcome_created,
        vault_path: vault_path.to_string_lossy().to_string(),
        welcome_path: "/Welcome.md".to_string(),
    })
}

#[tauri::command]
pub fn set_workspace_path(new_path: String, state: State<'_, WenmeiState>) -> Result<(), String> {
    let path = PathBuf::from(&new_path);
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    init_vault_meta(&path);
    let mut registry = load_registry(&state.registry_file);
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Vault")
        .to_string();
    let sandbox = upsert_registry_sandbox(
        &mut registry,
        "vault",
        vec![path.clone()],
        Some(name.clone()),
        "local",
        "folder-picker",
    )
    .ok_or_else(|| "Cannot authorize workspace without a root".to_string())?;
    save_registry_file(&state.registry_file, &registry)?;
    {
        let mut app_state = state.app_state.lock().unwrap();
        let id = if let Some(existing) = app_state
            .vaults
            .iter()
            .find(|v| v.path == new_path)
            .cloned()
        {
            existing.id
        } else {
            let id = format!("vault-{}", chrono::Local::now().timestamp_millis());
            app_state.vaults.push(Vault {
                id: id.clone(),
                name,
                path: new_path,
                is_active: false,
            });
            id
        };
        for vault in &mut app_state.vaults {
            vault.is_active = vault.id == id;
        }
        app_state.active_vault_id = id.clone();
        app_state.last_active_file = None;
        app_state.open_folders = vec!["/".to_string()];
        app_state.open_mode = "vault".to_string();
        app_state.metadata_mode = "local".to_string();
        app_state.sandbox_auth_status = "promoted".to_string();
        for sandbox_state in &mut app_state.sandboxes {
            sandbox_state.is_active = false;
        }
        if !app_state
            .sandboxes
            .iter()
            .any(|s| s.id == sandbox.id && s.vault_id == id)
        {
            app_state.sandboxes.push(Sandbox {
                id: sandbox.id.clone(),
                name: "Root sandbox".to_string(),
                vault_id: id.clone(),
                root_path: "/".to_string(),
                kind: "vault".to_string(),
                is_active: false,
            });
        }
        for sandbox_state in &mut app_state.sandboxes {
            sandbox_state.is_active = sandbox_state.id == sandbox.id && sandbox_state.vault_id == id;
        }
        app_state.active_sandbox_id = Some(sandbox.id);
    }
    log_action(&state, "added and activated vault".to_string());
    save_state(&state)
}

#[tauri::command]
pub fn list_vaults(state: State<'_, WenmeiState>) -> Result<Vec<Vault>, String> {
    Ok(state.app_state.lock().unwrap().vaults.clone())
}

#[tauri::command]
pub fn add_vault(path: String, state: State<'_, WenmeiState>) -> Result<Vault, String> {
    let vault_path = PathBuf::from(&path);
    fs::create_dir_all(&vault_path).map_err(|e| e.to_string())?;
    init_vault_meta(&vault_path);
    let mut registry = load_registry(&state.registry_file);
    let name = vault_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Vault")
        .to_string();
    let _ = upsert_registry_sandbox(
        &mut registry,
        "vault",
        vec![vault_path],
        Some(name.clone()),
        "local",
        "folder-picker",
    );
    save_registry_file(&state.registry_file, &registry)?;
    let vault = {
        let mut app_state = state.app_state.lock().unwrap();
        if let Some(existing) = app_state.vaults.iter().find(|v| v.path == path).cloned() {
            existing
        } else {
            let vault = Vault {
                id: format!("vault-{}", chrono::Local::now().timestamp_millis()),
                name,
                path,
                is_active: false,
            };
            app_state.vaults.push(vault.clone());
            vault
        }
    };
    log_action(&state, format!("joined vault {}", vault.name));
    save_state(&state)?;
    Ok(vault)
}

#[tauri::command]
pub fn set_active_vault(id: String, state: State<'_, WenmeiState>) -> Result<(), String> {
    let registry = load_registry(&state.registry_file);
    {
        let mut app_state = state.app_state.lock().unwrap();
        if !app_state.vaults.iter().any(|v| v.id == id) {
            return Err("Vault not found".to_string());
        }
        for vault in &mut app_state.vaults {
            vault.is_active = vault.id == id;
        }
        app_state.active_vault_id = id;
        app_state.last_active_file = None;
        app_state.open_folders = vec!["/".to_string()];
        let active_vault = active_vault_from_state(&app_state)?;
        let root = PathBuf::from(&active_vault.path);
        if let Some(auth) = registry
            .sandboxes
            .iter()
            .find(|sandbox| sandbox.primary_root == active_vault.path)
        {
            ensure_active_workspace(
                &mut app_state,
                &root,
                if auth.metadata_mode == "local" {
                    "vault"
                } else {
                    "sandbox"
                },
                &auth.metadata_mode,
                if auth.metadata_mode == "local" {
                    "promoted"
                } else {
                    "authorized"
                },
                &auth.kind,
                Some(auth.id.clone()),
            );
        } else if root.join(".wenmei").join("vault.json").exists() {
            ensure_active_workspace(
                &mut app_state,
                &root,
                "vault",
                "local",
                "promoted",
                "vault",
                None,
            );
        } else {
            ensure_active_workspace(
                &mut app_state,
                &root,
                "document",
                "global",
                "none",
                "document",
                None,
            );
        }
    }
    save_state(&state)
}

#[tauri::command]
pub fn list_sandboxes(state: State<'_, WenmeiState>) -> Result<Vec<Sandbox>, String> {
    Ok(state.app_state.lock().unwrap().sandboxes.clone())
}

#[tauri::command]
pub fn create_sandbox(
    name: String,
    root_path: String,
    kind: String,
    state: State<'_, WenmeiState>,
) -> Result<Sandbox, String> {
    let vault = active_vault(&state)?;
    let full_root = resolve_path(&vault, &root_path)?;
    let mut registry = load_registry(&state.registry_file);
    let registry_sandbox = upsert_registry_sandbox(
        &mut registry,
        "sandbox",
        vec![full_root],
        Some(name.clone()),
        "global",
        "app",
    )
    .ok_or_else(|| "Cannot authorize sandbox without a root".to_string())?;
    save_registry_file(&state.registry_file, &registry)?;
    let sandbox = Sandbox {
        id: registry_sandbox.id,
        name,
        vault_id: vault.id,
        root_path,
        kind,
        is_active: true,
    };
    {
        let mut app_state = state.app_state.lock().unwrap();
        for existing in &mut app_state.sandboxes {
            existing.is_active = false;
        }
        app_state.active_sandbox_id = Some(sandbox.id.clone());
        app_state.sandboxes.push(sandbox.clone());
    }
    log_action(&state, format!("created sandbox {}", sandbox.name));
    save_state(&state)?;
    Ok(sandbox)
}

#[tauri::command]
pub fn set_active_sandbox(id: String, state: State<'_, WenmeiState>) -> Result<(), String> {
    {
        let mut app_state = state.app_state.lock().unwrap();
        let active_vault_id = app_state.active_vault_id.clone();
        if !app_state
            .sandboxes
            .iter()
            .any(|s| s.id == id && s.vault_id == active_vault_id)
        {
            return Err("Sandbox not found".to_string());
        }
        for sandbox in &mut app_state.sandboxes {
            sandbox.is_active = sandbox.id == id && sandbox.vault_id == active_vault_id;
        }
        app_state.active_sandbox_id = Some(id);
    }
    save_state(&state)
}

#[tauri::command]
pub fn get_action_log(state: State<'_, WenmeiState>) -> Result<Vec<String>, String> {
    Ok(state.app_state.lock().unwrap().action_log.clone())
}

#[tauri::command]
pub fn get_sandbox_registry(state: State<'_, WenmeiState>) -> Result<SandboxRegistry, String> {
    Ok(load_registry(&state.registry_file))
}

#[tauri::command]
pub fn authorize_active_workspace(
    metadata_mode: Option<String>,
    state: State<'_, WenmeiState>,
) -> Result<AuthorizedSandbox, String> {
    let vault = active_vault(&state)?;
    let root = PathBuf::from(&vault.path);
    let metadata_mode = metadata_mode.unwrap_or_else(|| "global".to_string());
    if metadata_mode == "local" {
        init_vault_meta(&root);
    }

    let mut registry = load_registry(&state.registry_file);
    let sandbox = upsert_registry_sandbox(
        &mut registry,
        if metadata_mode == "local" {
            "vault"
        } else {
            "sandbox"
        },
        vec![root.clone()],
        Some(vault.name.clone()),
        &metadata_mode,
        if metadata_mode == "local" {
            "promote"
        } else {
            "app"
        },
    )
    .ok_or_else(|| "Cannot authorize workspace without a root".to_string())?;
    save_registry_file(&state.registry_file, &registry)?;

    {
        let mut app_state = state.app_state.lock().unwrap();
        ensure_active_workspace(
            &mut app_state,
            &root,
            if metadata_mode == "local" {
                "vault"
            } else {
                "sandbox"
            },
            &metadata_mode,
            if metadata_mode == "local" {
                "promoted"
            } else {
                "authorized"
            },
            &sandbox.kind,
            Some(sandbox.id.clone()),
        );
    }
    save_state(&state)?;
    Ok(sandbox)
}

#[tauri::command]
pub fn promote_active_workspace(state: State<'_, WenmeiState>) -> Result<AuthorizedSandbox, String> {
    authorize_active_workspace(Some("local".to_string()), state)
}

#[tauri::command]
pub fn complete_onboarding(state: State<'_, WenmeiState>) -> Result<(), String> {
    let mut app_state = state.app_state.lock().unwrap();
    app_state.onboarding_completed = true;
    drop(app_state);
    save_state(&state)
}
