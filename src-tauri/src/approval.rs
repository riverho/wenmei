use serde::{Deserialize, Serialize};
use std::io::Write;
use std::sync::OnceLock;
use tauri::{AppHandle, State};

use crate::journal::{append_journal_event, emit_notification};
use crate::state::WenmeiState;

// Approval relay (docs/design/sentinel-ledger.md §3) — "alerts with hands".
//
// T1 tier: detect y/n-style prompts on the terminal's recent stripped-output
// tail (the stand-in for a full VT grid), surface them as input.needs_response
// alerts carrying the answer keys, and inject the chosen keystrokes only after
// re-verifying the screen has not moved. A real VT parser and cursor-menu
// navigation (T2) are future work; the seam is here.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptPattern {
    /// Stable id (profile.kind), e.g. "claude-code.tool-permission".
    pub id: String,
    /// Substring markers that must all appear in the recent tail to match.
    pub markers: Vec<String>,
    /// Bytes to send on Allow (e.g. "\r" to accept the highlighted default,
    /// or "y\r").
    pub allow_keys: String,
    /// Bytes to send on Deny (e.g. "n\r" or "\x1b").
    pub deny_keys: String,
    pub label: String,
}

fn builtin_patterns() -> &'static Vec<PromptPattern> {
    static PATTERNS: OnceLock<Vec<PromptPattern>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            PromptPattern {
                id: "claude-code.tool-permission".into(),
                markers: vec!["Do you want".into(), "Yes".into(), "No".into()],
                allow_keys: "\r".into(),
                deny_keys: "\x1b".into(),
                label: "Tool permission".into(),
            },
            PromptPattern {
                id: "generic.yes-no".into(),
                markers: vec!["(y/n)".into()],
                allow_keys: "y\r".into(),
                deny_keys: "n\r".into(),
                label: "Confirm (y/n)".into(),
            },
            PromptPattern {
                id: "generic.proceed".into(),
                markers: vec!["Proceed?".into()],
                allow_keys: "y\r".into(),
                deny_keys: "n\r".into(),
                label: "Proceed?".into(),
            },
        ]
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedPrompt {
    pub pattern_id: String,
    pub label: String,
    pub prompt_text: String,
    /// Hash of the screen tail at detection — the injection command must be
    /// given this back and it must still match, or the prompt has moved.
    pub screen_hash: u64,
}

fn hash_screen(text: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut h);
    h.finish()
}

fn detect_in(text: &str) -> Option<(&'static PromptPattern, DetectedPrompt)> {
    for pattern in builtin_patterns() {
        if pattern.markers.iter().all(|m| text.contains(m.as_str())) {
            return Some((
                pattern,
                DetectedPrompt {
                    pattern_id: pattern.id.clone(),
                    label: pattern.label.clone(),
                    prompt_text: text
                        .lines()
                        .rev()
                        .take(4)
                        .collect::<Vec<_>>()
                        .into_iter()
                        .rev()
                        .collect::<Vec<_>>()
                        .join("\n"),
                    screen_hash: hash_screen(text),
                },
            ));
        }
    }
    None
}

/// Read the active terminal's recent tail and return a detected prompt, if
/// any. Side-effect-free — the caller dedups on `screen_hash` before
/// alerting so one prompt fires once.
pub fn detect_active_prompt(state: &State<'_, WenmeiState>) -> Option<DetectedPrompt> {
    let tail = active_session_tail(state, 12)?;
    detect_in(&tail).map(|(_p, d)| d)
}

/// Recent stripped-output tail of the focused terminal tab.
fn active_session_tail(state: &State<'_, WenmeiState>, lines: usize) -> Option<String> {
    let key = state.active_terminal_id.lock().ok()?.clone()?;
    let terminals = state.terminals.lock().ok()?;
    let session = terminals.get(&key)?;
    let nb = session.narration_buffer.lock().ok()?;
    Some(nb.recent_text(lines))
}

/// Alert on a freshly detected prompt (input.needs_response).
pub fn alert_prompt(
    app: &AppHandle,
    state: &State<'_, WenmeiState>,
    detected: &DetectedPrompt,
) {
    emit_notification(
        app,
        "input.needs_response",
        &format!("Agent asking: {}", detected.label),
        &detected.prompt_text,
        None,
    );
    let _ = append_journal_event(
        state,
        "input.needs_response",
        "approval-relay",
        None,
        format!("Detected prompt: {}", detected.label),
        serde_json::json!({ "pattern": detected.pattern_id }),
    );
}

#[tauri::command]
pub fn list_prompt_patterns() -> Vec<PromptPattern> {
    builtin_patterns().clone()
}

/// The prompt currently on the active terminal, if any — the approval card
/// calls this at click-time to get a fresh (pattern_id, screen_hash) pair.
#[tauri::command]
pub fn current_prompt(state: State<'_, WenmeiState>) -> Result<Option<DetectedPrompt>, String> {
    Ok(detect_active_prompt(&state))
}

/// Answer a detected prompt by injecting the pattern's keys — but only if the
/// screen still matches `expected_hash` (verify-then-act; never inject blind).
#[tauri::command]
pub fn approve_prompt(
    state: State<'_, WenmeiState>,
    app: AppHandle,
    pattern_id: String,
    allow: bool,
    expected_hash: u64,
) -> Result<(), String> {
    let pattern = builtin_patterns()
        .iter()
        .find(|p| p.id == pattern_id)
        .ok_or_else(|| format!("Unknown prompt pattern {pattern_id}"))?
        .clone();

    let current_tail =
        active_session_tail(&state, 12).ok_or("No active terminal")?;
    if hash_screen(&current_tail) != expected_hash {
        emit_notification(
            &app,
            "input.prompt_moved",
            "Prompt changed before your answer",
            "The terminal screen moved — not sending the keystroke. Take a look.",
            None,
        );
        return Err("prompt moved — aborted injection".into());
    }

    let keys = if allow {
        &pattern.allow_keys
    } else {
        &pattern.deny_keys
    };
    {
        let key = state
            .active_terminal_id
            .lock()
            .unwrap()
            .clone()
            .ok_or("No active terminal")?;
        let terminals = state.terminals.lock().unwrap();
        let session = terminals.get(&key).ok_or("No active terminal")?;
        let mut writer = session.writer.lock().unwrap();
        writer.write_all(keys.as_bytes()).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
    }

    append_journal_event(
        &state,
        "steering.injected",
        "approval-relay",
        None,
        format!(
            "{} {}",
            if allow { "Approved" } else { "Denied" },
            pattern.label
        ),
        serde_json::json!({ "pattern": pattern_id, "allow": allow, "origin": "approval-relay" }),
    )?;
    Ok(())
}
