# Design — Steering (Phase C)

**Status:** Design draft, 07 Jul 2026. Implementation gated on the B6 exit
validation (review surface must be human-verified first).
**Plan ref:** [`docs/revamp-phase-improvement-plan-04Jul2026.md`](../revamp-phase-improvement-plan-04Jul2026.md) §4 Phase C.

Level 2 of the revamp: the human stops operating the workhorse and starts
directing it. The sidecar (Pi) gets hands — it can type into the PTY — but
only ever with explicit human confirmation per injection.

## Principles

- **Nothing enters the PTY without human confirmation.** Every injection is
  proposed as a card in the UI; the user approves, edits, or dismisses. No
  standing "always allow" in v1.
- **Every injection is journaled** (`steering.injected`) with the full text,
  origin (draft-prompt | drift-alert | briefing), and the confirming click.
- **Agent-aware etiquette.** When and how it is safe to type differs per
  workhorse; profiles encode it (see below).

## `pi_type_into_terminal` — the injection command

New Tauri command in `src-tauri/src/terminal.rs`, reusing the existing PTY
writer handle (`TerminalSession.writer`, same path as `terminal_write`):

```
pi_type_into_terminal(text: String, origin: String) -> Result<(), String>
```

- Callable only after the frontend confirmation flow — the command is invoked
  *by the UI confirm button*, never directly by the Pi RPC event handler.
  Sidecar suggestions arrive as events; the frontend turns them into pending
  injection cards; only user confirmation calls the command.
- Appends the active agent profile's submit sequence (usually `\r`; some TUIs
  need bracketed-paste wrapping `\x1b[200~ … \x1b[201~`).
- Rejects when no terminal session is active, and (per profile) when the
  workhorse is mid-turn (busy heuristic from narration output cadence).
- Journals `steering.injected` and emits `steering-injected` to the UI.

Bridge: `piTypeIntoTerminal(text, origin)` in `src/lib/tauri-bridge.ts`.

## Draft-my-prompt flow (PiPanel)

1. User writes intent in plain language in a "Direct the agent" input.
2. Pi (RPC) drafts the actual workhorse prompt — `draftPrompt(intent)` sends a
   structured request over the existing Pi RPC session.
3. The draft renders as an editable pending-injection card with **Send to
   terminal** (confirmation) and **Discard**.
4. On confirm → `piTypeIntoTerminal(draft, "draft-prompt")`.

## Drift alerts

- The narration pipeline already digests workhorse output. Phase C adds a
  drift check: each digest is scored against the current stated task (the last
  confirmed injected prompt, kept in appStore).
- On drift, Pi produces a steering suggestion — *"You're rewriting the config
  loader; the task was the parser. Refocus."* — surfaced as a drift card in
  the commentary panel with a one-click **Steer** button.
- **Steer** is the confirmation; it calls `piTypeIntoTerminal(suggestion,
  "drift-alert")`. Dismissed cards are journaled as `steering.dismissed`.
- Rust side keeps a `drift` flag on the digest payload so the UI can badge it;
  scoring happens in the Pi session, not in Rust.

## Agent profiles

`AgentProfile` struct in `src-tauri/src/state.rs`, persisted in `state.json`,
mirrored in `tauri-bridge.ts`, selectable per terminal session:

```rust
pub struct AgentProfile {
    pub id: String,            // "claude-code" | "codex" | "aider" | "pi" | custom
    pub label: String,
    pub launch_command: String,        // e.g. "claude", "codex", "aider"
    pub submit_sequence: String,       // "\r" default
    pub use_bracketed_paste: bool,     // TUI agents that need paste guards
    pub inject_when: InjectWhen,       // Idle | Anytime | Never
    pub idle_ms: u64,                  // quiet time before "idle" (default 1500)
}
```

Built-ins ship for Claude Code (idle-only, bracketed paste), Codex
(idle-only), Aider (anytime — it queues input), and Pi interactive. Custom
profiles are user-editable. The profile also becomes the future home of
per-agent narration output filters (carried from Phase A risks).

## Touch points

- `src-tauri/src/terminal.rs` — `pi_type_into_terminal`, busy/idle heuristic.
- `src-tauri/src/state.rs` — `AgentProfile`, per-session profile id.
- `src-tauri/src/journal.rs` — `steering.injected` / `steering.dismissed` kinds.
- `src/lib/tauri-bridge.ts` — `piTypeIntoTerminal`, `AgentProfile` mirror.
- `src/components/PiPanel.tsx` — intent input, pending-injection cards, drift
  cards.
- `src/components/TerminalPanel.tsx` — profile selector on session start.
- `src/store/appStore.ts` — pending injections, current stated task, profiles.

## Exit criterion (C6)

Run a real agent: draft a prompt through Pi and send it with one confirmation
click; trigger a drift alert and steer with one click. If mid-run injection
confuses the tested agents despite profile etiquette, stop and re-scope
(fallback: injection only between turns).
