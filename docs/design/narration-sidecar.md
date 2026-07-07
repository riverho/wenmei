# Design — Narration Sidecar (Phase A)

**Status:** Implemented (05 Jul 2026); doc restored 07 Jul 2026 after the
original was lost uncommitted.
**Plan ref:** [`docs/revamp-phase-improvement-plan-04Jul2026.md`](../revamp-phase-improvement-plan-04Jul2026.md) §4 Phase A.

The sidecar (Pi RPC) narrates what the workhorse (any CLI agent in the PTY)
is doing, in plain language, without the workhorse cooperating or knowing.

## Event flow

```
PTY output bytes ──▶ NarrationBuffer.push_bytes()      (src-tauri/src/narration.rs)
                       │  strip ANSI (strip_ansi_escapes)
                       │  drop near-duplicate lines (TUI redraw dedup)
sandbox-files-changed ─▶ NarrationBuffer.annotate_file_changes()
                       │
        flush thread (500ms tick) ──▶ tick() flush triggers:
                       │    • ≥10s since last flush (MIN_FLUSH_INTERVAL_MS)
                       │    • AND (idle ≥2.5s OR buffer ≥1500 chars OR pending file changes)
                       ▼
        emit "narration-digest" { id: "narrate-<n>", digest, file_changes }
                       │
        ├──▶ frontend PiPanel commentary sub-panel ("What's happening")
        ├──▶ Pi RPC session as observation message (main.rs tee)
        └──▶ .wenmei/journal.jsonl as kind "narration.digest", source "sidecar"
```

Key constants (`narration.rs`): `MAX_BUFFER_CHARS 1500`, `IDLE_FLUSH_MS 2500`,
`MIN_FLUSH_INTERVAL_MS 10000`, `MAX_WINDOW_LINES 40`. The ≥10s rate floor is
the token-cost guardrail — never lower it without revisiting narration cost.

Digest ids carry the `narrate-` prefix so the frontend can filter narration
traffic out of the normal Pi chat transcript.

## Touch points

- `src-tauri/src/narration.rs` — `NarrationBuffer`, `NarrationDigest`,
  `spawn_narration_flush_thread` (500ms tick, emits `narration-digest`).
- `src-tauri/src/main.rs` — PTY output tee into the buffer; journal append of
  `narration.digest`; `terminal_set_narration_enabled` command.
- `src-tauri/src/journal.rs` — `annotate_file_changes` wiring from
  `sandbox-files-changed`.
- `src/lib/tauri-bridge.ts` — narration enable/disable command wrapper.
- `src/components/PiPanel.tsx` — commentary sub-panel; filters `narrate-` ids
  out of chat; updates live from `pi-rpc-event` / `narration-digest`.
- `src/components/TerminalPanel.tsx` — per-terminal "Narrate" toggle.

## Opt-in and kill switch

- Narration is **opt-in per terminal session** — `enabled` defaults to `false`
  on `NarrationBuffer` and on the `TerminalSession` UI state.
- Disabling clears the buffer and pending file changes immediately
  (`set_enabled(false)`), so nothing buffered leaks after opt-out.
- No PTY output leaves the machine except through the user's own Pi session.

## Risks carried forward

- TUI-heavy agents (Claude Code's own UI) still produce noisy digests; the
  alphanumeric-normalize dedup helps but per-agent output filters belong in
  Phase C agent profiles.
- Narration quality/cost tuning (depth selection, summarize-on-idle) remains
  open — see plan §6.
