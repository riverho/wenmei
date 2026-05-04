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
