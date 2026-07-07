# Design — Memory & the Foreman (Phase D)

**Status:** Design draft, 07 Jul 2026. Implementation gated on the C6 exit
validation (steering must be human-verified first).
**Plan ref:** [`docs/revamp-phase-improvement-plan-04Jul2026.md`](../revamp-phase-improvement-plan-04Jul2026.md) §4 Phase D.

Level 3 of the revamp: the sidecar becomes persistent in a way workhorses
never are — institutional memory, a foreman over multiple terminals, and a
supervised night shift. Everything stays file-native under `.wenmei/`.

## Vault journal & auto-briefing

- Pi maintains `.wenmei/journal/` as plain markdown alongside the existing
  `journal.jsonl` event log: `journal/YYYY-MM-DD.md` daily notes plus a
  rolling `journal/BRIEFING.md` — what was tried, what failed, what the human
  rejected and why (sourced from `review.rejected` events + Pi's own notes).
- **Auto-briefing:** on a fresh workhorse session, Rust builds a briefing from
  `BRIEFING.md` (truncated, newest-first) and proposes it as a pending
  injection card — same confirmation flow as steering (`pi_type_into_terminal`
  with origin `briefing`). Nothing is pasted without the user's click.
- Backend: `briefing` builder in `src-tauri/src/journal.rs`
  (`build_briefing()` + `briefing` bridge command); Pi appends to the journal
  via the existing `append_journal` command surface.

## The foreman — multi-terminal dashboard

- Multiple PTY sessions, each scoped to its sandbox (existing model). New
  `TerminalActivity` tracking in `src-tauri/src/terminal.rs`: per-session
  status derived from output cadence —
  `active` (output < idle_ms ago) / `idle` (quiet, prompt-like last line) /
  `stuck` (same deduped output cycling, or quiet > stuck threshold mid-task).
- Heuristics reuse the narration buffer's deduped line window; thresholds come
  from the session's `AgentProfile` (Phase C).
- UI: a status strip across terminal tabs in `TerminalPanel.tsx` ("Terminal 2
  finished; Terminal 1 stuck 20 min — kill and retry?"), with Pi watching all
  sessions' digests, not just the focused one.

## Night shift v1

- User leaves a task list (default `TODO.md`) in the vault; Pi drives the
  workhorse through it item by item, overnight, unattended.
- New `src-tauri/src/nightshift.rs`: run loop that (1) opens a review session
  per task item, (2) injects the next task prompt using the briefing +
  steering machinery **with a standing approval granted once, explicitly, at
  night-shift start** (the one scoped exception to per-injection
  confirmation — plan §0 allows explicit standing approvals), (3) watches for
  idle/stuck via foreman heuristics, (4) stages every changeset — **nothing
  auto-commits, nothing is approved automatically**.
- Morning briefing: `journal/BRIEFING.md` section summarizing per-task
  outcome + links to staged changesets awaiting ReviewPanel approval.
- Bridge: `nightShiftStart(taskFile)` / `nightShiftStop()` in
  `tauri-bridge.ts`; kill switch always visible in the UI.

## Touch points

- `src-tauri/src/journal.rs` — `build_briefing()`, briefing command.
- `src-tauri/src/terminal.rs` — `TerminalActivity` status heuristics.
- `src-tauri/src/nightshift.rs` — night-shift run loop (new module).
- `src/lib/tauri-bridge.ts` — `briefing`, `nightShift*`, activity mirrors.
- `src/components/TerminalPanel.tsx` — status strip, stuck badges.
- `src/components/PiPanel.tsx` — briefing card, night-shift controls.

## Exit criterion (D5)

Leave a 3-item `TODO.md`, start night shift, come back to: a morning briefing,
one staged changeset per task in ReviewPanel, and zero auto-committed or
auto-approved files. If the workhorse can't be driven reliably unattended,
re-scope night shift to attended batch mode.
