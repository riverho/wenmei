use std::fs;
use std::path::PathBuf;
use tauri::State;
use walkdir::WalkDir;

use crate::state::{relative_path, active_vault, SearchResult, Vault, WenmeiState, load_registry};

fn search_vaults(query: String, vaults: Vec<Vault>) -> Result<Vec<SearchResult>, String> {
    let needle = query.to_lowercase();
    let mut results = vec![];
    if needle.trim().is_empty() {
        return Ok(results);
    }
    for vault in vaults {
        let root = PathBuf::from(&vault.path);
        for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.components().any(|c| c.as_os_str() == ".wenmei") || !path.is_file() {
                continue;
            }
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            let content = match fs::read_to_string(path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            for (i, line) in content.lines().enumerate() {
                if line.to_lowercase().contains(&needle) {
                    let snippet: String = line.chars().take(140).collect();
                    results.push(SearchResult {
                        vault_id: vault.id.clone(),
                        vault_name: vault.name.clone(),
                        path: relative_path(path, &root),
                        name: name.to_string(),
                        line_number: i + 1,
                        snippet,
                    });
                    break;
                }
            }
        }
    }
    Ok(results)
}

#[tauri::command]
pub fn search_workspace(
    query: String,
    state: State<'_, WenmeiState>,
) -> Result<Vec<SearchResult>, String> {
    let vault = active_vault(&state)?;
    search_vaults(query, vec![vault])
}

#[tauri::command]
pub fn search_all_vaults(
    query: String,
    state: State<'_, WenmeiState>,
) -> Result<Vec<SearchResult>, String> {
    let registry = load_registry(&state.registry_file);
    let authorized_roots: Vec<String> = registry
        .sandboxes
        .iter()
        .flat_map(|sandbox| sandbox.roots.clone())
        .collect();
    let vaults = state
        .app_state
        .lock()
        .unwrap()
        .vaults
        .clone()
        .into_iter()
        .filter(|vault| authorized_roots.iter().any(|root| root == &vault.path))
        .collect();
    search_vaults(query, vaults)
}
