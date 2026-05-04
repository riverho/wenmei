// Several helpers are only reachable from the !windows branch (terminal/CLI
// installer). Suppress unused-fn / unread-field lints on Windows builds so
// the cross-platform compile stays warning-clean without sprinkling allow
// attrs across each cfg-gated helper.
#![cfg_attr(target_os = "windows", allow(unused))]

mod logging;
mod state;
mod journal;
mod file_ops;
mod terminal;
mod pi_rpc;
mod vault;
mod search;
mod polling;
mod cli;

use std::fs;
use std::path::PathBuf;
use tauri::{Emitter, Manager};

use crate::state::{Vault, WenmeiState};

fn main() {
    let app = tauri::Builder::default()
        .manage(WenmeiState::new())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            logging::init(&state::config_dir());
            polling::start_file_polling(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            file_ops::list_files,
            file_ops::read_file,
            file_ops::write_file,
            file_ops::create_file,
            file_ops::create_folder,
            file_ops::rename_file,
            file_ops::delete_file,
            file_ops::move_file,
            file_ops::toggle_pin,
            file_ops::get_pinned_files,
            file_ops::get_recent_files,
            file_ops::copy_file_path,
            file_ops::reveal_in_folder,
            search::search_workspace,
            search::search_all_vaults,
            state::get_app_state,
            state::save_app_state,
            state::get_workspace_path,
            state::get_initial_file,
            cli::install_cli_integration,
            cli::cli_integration_status,
            cli::run_install_script,
            vault::list_vaults,
            vault::add_vault,
            vault::set_active_vault,
            vault::list_sandboxes,
            vault::create_sandbox,
            vault::set_active_sandbox,
            vault::get_action_log,
            vault::get_sandbox_registry,
            vault::authorize_active_workspace,
            vault::promote_active_workspace,
            vault::ensure_default_vault,
            vault::set_workspace_path,
            vault::complete_onboarding,
            journal::append_journal,
            journal::list_journal_events,
            pi_rpc::pi_panel_start,
            pi_rpc::pi_panel_prompt,
            pi_rpc::pi_panel_abort,
            pi_rpc::pi_panel_restart,
            pi_rpc::pi_panel_stop,
            terminal::terminal_start,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_stop,
            terminal::pty_run_commands,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {
        #[cfg(target_os = "macos")]
        handle_run_event(_app_handle, _event);
    });
}

// macOS-only: Finder file-association arrives as RunEvent::Opened. Other
// platforms deliver opened paths via CLI args (handled at startup) or via
// tauri-plugin-single-instance (future work).
#[cfg(target_os = "macos")]
fn handle_run_event(app_handle: &tauri::AppHandle, event: tauri::RunEvent) {
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

                                let id = format!(
                                    "vault-{}",
                                    chrono::Local::now().timestamp_millis()
                                );
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

                                let meta_root =
                                    PathBuf::from(&vault_path_str).join(".wenmei");
                                let _ = fs::create_dir_all(
                                    meta_root.join("terminal").join("logs"),
                                );
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

                                let rel_path =
                                    path.strip_prefix(parent).unwrap_or(&path);
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
                            let _ = crate::state::save_state(&state);
                        }
                    }

                let _ = app_handle.emit("os-file-opened", emit_path);
            }
        }
    }
}
