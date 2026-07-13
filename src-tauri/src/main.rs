// Hide the console window in release builds on Windows. Debug builds keep it
// for Tauri/Vite output. The explicit attribute is belt-and-suspenders
// alongside the tauri_build linker flag.
#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

mod cli;
mod control;
mod file_ops;
mod journal;
mod logging;
mod narration;
mod nightshift;
mod pi_rpc;
mod platform;
mod polling;
mod review;
mod search;
mod state;
mod terminal;
mod approval;
mod heartbeat;
mod updater;
mod vault;
mod window;

use crate::platform::Platform;
use crate::state::WenmeiState;
use tauri::Emitter;

fn is_wsl() -> bool {
    // WSL1/2 detection: /proc/version contains "microsoft" or "WSL",
    // and WSL2 has /proc/sys/fs/binfmt_misc/WSLInterop.
    std::fs::read_to_string("/proc/version")
        .map(|s| s.to_lowercase().contains("microsoft") || s.to_lowercase().contains("wsl"))
        .unwrap_or(false)
        || std::path::Path::new("/proc/sys/fs/binfmt_misc/WSLInterop").exists()
}

fn main() {
    // WSL has no GPU driver for WebKitGTK's threaded compositor;
    // disabling it avoids libEGL/MESA/ZINK warnings and long startup.
    if is_wsl() {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    let app = tauri::Builder::default()
        .manage(WenmeiState::new())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // argv[0] is the executable path; argv[1+] are the file paths
            // from a double-click file-open event on Windows/Linux. The
            // frontend's read_file takes vault-relative paths, so absolute
            // paths inside a known vault convert to "/rel" here (the macOS
            // Opened handler does the same in platform/macos.rs).
            if argv.len() > 1 {
                let paths = window::resolve_open_paths(app, &argv[1..]);
                let _ = app.emit("single-instance", paths);
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            logging::init(&state::config_dir());
            logging::install_panic_hook(app.handle().clone());
            polling::start_file_polling(app.handle().clone());
            control::start_control_server(app.handle().clone());
            heartbeat::start_heartbeat(app.handle().clone());
            narration::spawn_digest_journaler(app.handle());
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
            review::review_session_start,
            review::review_session_close,
            review::review_approve,
            review::review_reject,
            review::review_changeset,
            review::review_annotate,
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
            vault::remove_vault,
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
            journal::build_briefing,
            journal::export_audit,
            updater::check_for_update,
            approval::list_prompt_patterns,
            approval::current_prompt,
            approval::approve_prompt,
            heartbeat::run_card_create,
            heartbeat::run_card_list,
            heartbeat::run_card_set_status,
            heartbeat::run_card_touch,
            heartbeat::run_card_delete,
            nightshift::night_shift_start,
            nightshift::night_shift_status,
            pi_rpc::pi_panel_start,
            pi_rpc::pi_panel_prompt,
            pi_rpc::pi_panel_abort,
            pi_rpc::pi_panel_restart,
            pi_rpc::pi_panel_stop,
            terminal::terminal_start,
            terminal::terminal_statuses,
            terminal::terminal_set_active,
            terminal::terminal_write,
            terminal::pi_type_into_terminal,
            terminal::terminal_resize,
            terminal::terminal_stop,
            terminal::terminal_set_narration_enabled,
            terminal::pty_run_commands,
            platform::get_platform,
            window::open_file_window,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        platform::Current::handle_run_event(app_handle, event);
    });
}
