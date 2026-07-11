use std::path::Path;
use tracing_appender::rolling::{RollingFileAppender, Rotation};

pub fn init(config_dir: &Path) {
    let log_dir = config_dir.join("logs");
    let _ = std::fs::create_dir_all(&log_dir);

    let file_appender = RollingFileAppender::new(Rotation::DAILY, &log_dir, "wenmei.log");

    tracing_subscriber::fmt()
        .with_writer(file_appender)
        .with_max_level(tracing::Level::INFO)
        .with_ansi(false)
        .init();
}

/// Install a global panic hook: any thread panic lands in crash.log and,
/// best-effort, in the sidecar feed as a system.panic alert. State may be
/// poisoned mid-panic, so the file write is the reliable half.
pub fn install_panic_hook(app: tauri::AppHandle) {
    let config_dir = crate::state::config_dir();
    std::panic::set_hook(Box::new(move |info| {
        let msg = format!("[{}] panic: {}\n", chrono::Utc::now().to_rfc3339(), info);
        let crash_file = config_dir.join("crash.log");
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&crash_file)
            .and_then(|mut f| std::io::Write::write_all(&mut f, msg.as_bytes()));
        eprintln!("{msg}");
        crate::journal::emit_notification(
            &app,
            "system.panic",
            "Wenmei hit an internal error",
            "Details were written to crash.log — please report this.",
            None,
        );
    }));
}
