# Project Memory: Wenmei

## Identity

Tauri v2 + React 19 + Vite desktop app. Local-first markdown vaults; no backend, no database. Plain files on disk are truth.

## Revamp Thesis

Wenmei becomes **the safe desktop where AI agents do real work on files — visible, reviewable, reversible**.

## Architecture

- **Workhorse:** any CLI agent running in a PTY terminal.
- **Sidecar:** Pi `--mode rpc` (JSON-RPC), structured and always-on.
- **Shared ground:** the vault/sandbox folder; both agents see the same files.

## Key Files

- `src-tauri/src/main.rs` — monolithic Rust backend (~2295 lines).
- `src/lib/tauri-bridge.ts` — invoke wrappers + TS mirrors of Rust structs.
- `src/store/appStore.ts` — Zustand UI state, persisted to localStorage.
- `src/components/PiPanel.tsx` — Pi RPC chat / commentary UI.
- `src/components/TerminalPanel.tsx` — PTY terminal UI.
- `docs/design/*.md` — phase designs (A narration, B review, C steering, D memory).
- `.agents-playbook/` — this playbook.

## Conventions

- Run `npm run format && npm run lint && npm run check` before commits.
- Add a Tauri command → update `main.rs` + `tauri-bridge.ts`.
- Change state shape → update `appStore.ts` + Rust `AppState` + `tauri-bridge.ts`.
- Keep `main.rs` modularization on the radar before Phase C.

## Roadmap Milestones (set 07 Jul 2026)

Source: docs/revamp-phase-improvement-plan-04Jul2026.md. Target dates assume the
plan's phase budgets; re-check at each `pb reflect`.

| Milestone            | Phase / tasks | Exit criterion                                                | Target              |
| -------------------- | ------------- | ------------------------------------------------------------- | ------------------- |
| M1 Narration         | A1–A6         | Narration beats raw terminal                                  | ✅ done 05 Jul 2026 |
| M2 Trust surface     | B1–B8         | ReviewPanel catches all agent mutations; tree committed clean | 24 Jul 2026         |
| M3 Steering          | C1–C6         | Human steers a live agent mid-run                             | 21 Aug 2026         |
| M4 Memory & foreman  | D1–D5         | Overnight run wakes to a briefing, nothing auto-committed     | 02 Oct 2026         |
| M5 Business & launch | E1–E3, L1–L4  | v1.0.0 tagged + released on mac/win/linux with landing page   | 13 Nov 2026         |

Rules of the road:

- Each phase opens with a `pb cycle --new` brief and closes with `pb reflect`.
- Exit-validation tasks (B6, C6, D5) are gates — do not start the next phase's
  implementation tasks until the gate is recorded done (design-doc tasks C1/D1
  may start early).
- L4 (publish/announce) requires explicit human sign-off; never auto-publish.
- Design docs live in docs/design/ and are referenced by design_ref; they were
  lost once (deleted uncommitted, 05–07 Jul 2026) — commit them as soon as
  written (B8 covers the current tree).

## Playbook Commands

All from repo root:

- `node .agents-playbook/scripts/pb.mjs status`
- `node .agents-playbook/scripts/pb.mjs next --claim`
- `node .agents-playbook/scripts/pb.mjs validate`
- `node .agents-playbook/scripts/pb.mjs validate --task <id>`
- `node .agents-playbook/scripts/pb.mjs record --task <id> --action <a> --status <s> --notes "..."`
- `node .agents-playbook/scripts/pb.mjs report`
