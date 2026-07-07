# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The canonical agent guide for this repo is [`AGENTS.md`](./AGENTS.md). Read it first — it covers commands, architecture, conventions, known bugs, and which files to touch for common changes. Everything below is a Claude-specific supplement.

## TL;DR

Tauri v2 + React 19 + Vite desktop app — an "agentic thinking environment" for local markdown folders. No database, no web backend. Plain files on disk are truth.

## Commands

Run in order before committing or asking for review:

```bash
npm run format   # Prettier
npm run lint     # ESLint flat config on **/*.{ts,tsx}
npm run check    # tsc -b (project references)
npm run test     # Vitest (--passWithNoTests; current glob `api/**/*.test.ts` matches nothing)
```

Dev / build:

```bash
npm install
npm run tauri dev                # Vite + Tauri desktop, dev mode
cd src-tauri && cargo check      # Rust-only compile check
npm run desktop:build:mac        # production .dmg (aarch64)
npm run desktop:build:win        # production .msi + .exe
npm run desktop:build:linux      # production .deb + .rpm + .AppImage
```

Running a single Vitest file: `npx vitest run path/to/file.test.ts` (or drop `run` for watch).

## Architecture quick map

- **Monolithic Rust backend:** all commands, state, PTY, and Pi RPC live in one file — `src-tauri/src/main.rs` (~2300 lines, no modules).
- **Bridge:** `src/lib/tauri-bridge.ts` is the single chokepoint wrapping every `invoke()` and mirroring Rust structs as TS types. Any new Tauri command must be added here.
- **State dual-persisted:** Zustand store at `src/store/appStore.ts` (localStorage key `wenmei-store`) and Rust `AppState` → `state.json`. Changing state shape touches both sides plus the bridge.
- **Vault vs sandbox:** vault = promoted folder root with local `.wenmei/` metadata; sandbox = subfolder-scoped working context (own terminal/Pi session/journal). Pi commands run against the active sandbox/vault. Path safety: relative-only, `..` rejected, `.wenmei/` hidden, deletes go to `.wenmei/trash/`.
- **Pi integration:** Wenmei does **not** bundle Pi — expects a global `pi` binary (e.g. `/usr/local/bin/pi`). Two surfaces: interactive PTY (`Terminal`) and `pi --mode rpc` JSON-RPC (`PiPanel`).
- **Rust → frontend events:** `sandbox-files-changed`, `pi-rpc-event`, `terminal-output`, `single-instance` (Windows/Linux file-open args).

## Constraints from DEV_PLAN.md

Do not reintroduce: Hono/tRPC, MySQL/Drizzle, fake DB docs, large shadcn component dumps, or any web backend build path.
