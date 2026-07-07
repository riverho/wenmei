use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

const MAX_BUFFER_CHARS: usize = 1500;
const IDLE_FLUSH_MS: u64 = 2500;
const MIN_FLUSH_INTERVAL_MS: u64 = 10000;
const MAX_WINDOW_LINES: usize = 40;

#[derive(Debug, Clone)]
pub struct NarrationDigest {
    pub text: String,
    pub file_changes: Vec<String>,
    pub drift: bool,
    pub drift_reason: Option<String>,
}

pub struct NarrationBuffer {
    buf: String,
    last_flush: Instant,
    last_output: Instant,
    pending_file_changes: Vec<String>,
    recent_lines: VecDeque<String>,
    enabled: bool,
}

impl NarrationBuffer {
    pub fn new() -> Self {
        let now = Instant::now();
        Self {
            buf: String::new(),
            last_flush: now,
            last_output: now,
            pending_file_changes: Vec::new(),
            recent_lines: VecDeque::with_capacity(MAX_WINDOW_LINES),
            enabled: false,
        }
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
        if !enabled {
            self.buf.clear();
            self.pending_file_changes.clear();
        }
    }

    pub fn push_bytes(&mut self, data: &[u8]) {
        if !self.enabled {
            return;
        }
        self.last_output = Instant::now();
        let cleaned = strip_ansi_escapes::strip_str(
            String::from_utf8_lossy(data).as_ref(),
        );
        if cleaned.trim().is_empty() {
            return;
        }

        for line in cleaned.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            // Drop near-duplicate consecutive lines (TUI redraw noise).
            if self
                .recent_lines
                .back()
                .map(|last| similar_enough(last, trimmed))
                .unwrap_or(false)
            {
                continue;
            }
            self.recent_lines.push_back(trimmed.to_string());
            if self.recent_lines.len() > MAX_WINDOW_LINES {
                self.recent_lines.pop_front();
            }
            if !self.buf.is_empty() {
                self.buf.push('\n');
            }
            self.buf.push_str(trimmed);
        }
    }

    pub fn annotate_file_changes(&mut self, changes: Vec<String>) {
        if !self.enabled {
            return;
        }
        for c in changes {
            if !self.pending_file_changes.contains(&c) {
                self.pending_file_changes.push(c);
            }
        }
    }

    /// Returns a digest if a flush trigger fired. Should be called regularly.
    pub fn tick(&mut self) -> Option<NarrationDigest> {
        if !self.enabled {
            return None;
        }
        let now = Instant::now();
        if now.duration_since(self.last_flush).as_millis() < MIN_FLUSH_INTERVAL_MS as u128 {
            return None;
        }
        let idle = now.duration_since(self.last_output).as_millis() >= IDLE_FLUSH_MS as u128;
        let full = self.buf.chars().count() >= MAX_BUFFER_CHARS;
        if !idle && !full && self.pending_file_changes.is_empty() {
            return None;
        }
        if self.buf.is_empty() && self.pending_file_changes.is_empty() {
            return None;
        }

        let text = std::mem::take(&mut self.buf);
        let file_changes = std::mem::take(&mut self.pending_file_changes);
        let drift_reason = detect_drift(&text, &file_changes);
        let drift = drift_reason.is_some();
        self.last_flush = now;
        Some(NarrationDigest {
            text,
            file_changes,
            drift,
            drift_reason,
        })
    }
}

fn detect_drift(text: &str, file_changes: &[String]) -> Option<String> {
    let lower = text.to_lowercase();
    let risky_output = [
        "permission denied",
        "fatal:",
        "panic",
        "failed",
        "blocked",
        "stuck",
        "cannot continue",
        "outside the",
    ]
    .iter()
    .find(|needle| lower.contains(**needle));
    if let Some(needle) = risky_output {
        return Some(format!("terminal output includes `{}`", needle));
    }

    if let Some(path) = file_changes
        .iter()
        .find(|path| path.starts_with('/') || path.contains("../"))
    {
        return Some(format!("file change may be outside sandbox: {}", path));
    }

    None
}

fn similar_enough(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    // Allow minor cursor-position differences by comparing alphanumeric content.
    let normalize = |s: &str| {
        s.chars()
            .filter(|c| c.is_alphanumeric() || c.is_ascii_punctuation())
            .collect::<String>()
    };
    normalize(a) == normalize(b)
}

pub type SharedNarrationBuffer = Arc<Mutex<NarrationBuffer>>;

pub fn spawn_narration_flush_thread(
    app: tauri::AppHandle,
    buffer: SharedNarrationBuffer,
) {
    std::thread::spawn(move || {
        let mut counter: u64 = 0;
        loop {
            std::thread::sleep(Duration::from_millis(500));
            let digest = {
                let mut buf = buffer.lock().unwrap();
                buf.tick()
            };
            if let Some(digest) = digest {
                counter += 1;
                let payload = serde_json::json!({
                    "id": format!("narrate-{}", counter),
                    "digest": digest.text,
                    "file_changes": digest.file_changes,
                    "drift": digest.drift,
                    "drift_reason": digest.drift_reason,
                });
                let _ = app.emit("narration-digest", payload);
            }
        }
    });
}
