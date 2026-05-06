// Hide the console window in release builds on Windows. Debug builds keep it
// for Tauri/Vite output. The explicit attribute is belt-and-suspenders
// alongside the tauri_build linker flag.
#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

mod cli;
mod file_ops;
mod journal;
mod logging;
mod pi_rpc;
mod platform;
mod polling;
mod search;
mod state;
mod terminal;
mod vault;

use crate::platform::Platform;
use crate::state::WenmeiState;
use tauri::Emitter;

fn main() {
    let app = tauri::Builder::default()
        .manage(WenmeiState::new())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // argv[0] is the executable path; argv[1+] are the file paths
            // from a double-click file-open event on Windows/Linux.
            if argv.len() > 1 {
                let _ = app.emit("single-instance", argv[1..].to_vec());
            }
        }))
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
            platform::get_platform,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        platform::Current::handle_run_event(app_handle, event);
    });
}
