---
phase: 7
started: "2026-07-07T10:52:22.388Z"
goal: "Phase F: wire playground UX into the real app — unified sidecar feed, notifications, multi-session terminal tabs with per-tab narration, and all settings persisted (business layer ready)"
stop: "F10 gate: checks green and tabs/feed/settings round-trip a restart in a human run; stop before L4 publish"
---

# Cycle Brief — phase 7

> Confirm this at the START of each phase, before claiming work. The North Star does
> not change; this cycle's goal does. Fill all five, then `node scripts/pb.mjs status`.

## 1. What is this cycle's goal?

Phase F: wire playground UX into the real app — unified sidecar feed, notifications, multi-session terminal tabs with per-tab narration, and all settings persisted (business layer ready)

## 2. What challenges do I foresee?

Two writers on one tree: the spawned UX agent works in a git worktree (F6/F7 frontend port) while the orchestrator wires Rust in the main tree — merge at integration, expect conflicts in tauri-bridge.ts and appStore.ts. Multi-session PTY (F3) is the riskiest refactor: terminal.rs assumes a single session; every command/event grows a session_id. The tree also carries ~20 uncommitted files from the prior session — commit checkpoints per task so nothing is lost again.

## 3. What were the previous challenges?

Phases B–E were implemented across two sessions; grep-level checks pass but only some paths had human validation. Design docs were once lost uncommitted (now tracked). Acceptance checks run without a shell — wrap $() in bash -c.

## 4. Where do I stop / hand back?

F10 gate: checks green and tabs/feed/settings round-trip a restart in a human run; stop before L4 publish

## 5. Conflicts with my own (agent) memory?

My memory said C/D/E implementation was gated on B6 human validation; the folder now records those phases done (another session executed them) and the user has directed Phase F on top. Folder wins: proceed with F, keep F10 as the human gate before L4.
