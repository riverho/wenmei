# AGENTS.md — Wenmei

Tauri v2 + React 19 + Vite desktop app ("agentic thinking environment" for local markdown folders). No database, no web backend — plain files on disk are truth.

## Quick start

```bash
npm install
npm run tauri dev        # starts Vite + Tauri desktop
```

## Commands (run in order: format → lint → check → test)

| Command                       | What                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run format`              | Prettier — double quotes, semis, trailing commas, 80 width, arrow parens avoid                      |
| `npm run lint`                | ESLint flat config on `**/*.{ts,tsx}`                                                               |
| `npm run check`               | `tsc -b` (project references: `tsconfig.app.json` + `tsconfig.node.json`)                           |
| `npm run test`                | Vitest run (config searches `api/**/*.test.ts` — no `api/` dir exists; update glob if adding tests) |
| `cd src-tauri && cargo check` | Rust compilation check                                                                              |

Always run `format → lint → check` before committing or asking for review.

## Architecture

### Monolithic Rust backend

All backend logic in one file: `src-tauri/src/main.rs` (~2295 lines). Commands, state, PTY, Pi RPC — all there. No modules.

### Frontend ↔ Backend bridge

`src/lib/tauri-bridge.ts` — single file wrapping every `invoke()` call + TS type mirrors of Rust structs. If you add a Tauri command, update this file.

Rust emits events to frontend via `app.emit()`:

- `sandbox-files-changed` — file watcher triggered
- `pi-rpc-event` — streaming Pi response chunks
- `terminal-output` — PTY byte stream

### State

- **Frontend:** Zustand single store (`src/store/appStore.ts`), persisted to localStorage under key `wenmei-store`
- **Backend:** Rust `AppState` persisted to `state.json` on disk (dual persistence with frontend)

### Naming conventions

- **React components:** PascalCase files, default exports (`Header.tsx`)
- **Hooks:** `use` prefix, camelCase (`useKeyboardShortcuts.ts`)
- **Rust structs:** PascalCase, snake_case commands
- **TS types:** PascalCase matching Rust structs
- **Path alias:** `@/` → `src/` (Vite + tsconfig)

## Vault / Sandbox model

- **Vault:** a joined folder root. Plain markdown files.
- **Sandbox:** subfolder-scoped working context inside a vault — owns its own terminal/Pi sessions and journal.
- Pi commands always run against **active sandbox/vault**.
- **Safety:** relative paths only inside vault; `..` rejected; `.wenmei/` hidden from tree/search; delete moves to `.wenmei/trash/`; mutations logged to action log.

## Pi integration

Wenmei does **not** bundle Pi. Expects global `pi` at `/usr/local/bin/pi` (discoverable via `which`).

Two surfaces:

1. **Terminal mode:** interactive `pi` in PTY — direct human control
2. **Pi Panel:** `pi --mode rpc` — JSON-RPC over stdin/stdout

**Ownership:** Global Pi owns executable/runtime/provider auth/model config. Wenmei sandbox owns cwd/session dir/memory/action log/trust mode/file boundary/UI state.

Sessions stored at `<vault>/.wenmei/pi-sessions/<sandbox-id>`.

## Known bugs

- `src-tauri/src/main.rs:2270` — `RunEvent::Opened` path formatting has a space: `format!("/ {}", rel)` should be `format!("/{}", rel)`. Finder file-open events arrive with malformed vault-relative paths.
- Background file poller runs every 1.2s with full `WalkDir` — can repeatedly trigger macOS permission dialogs on Documents/Desktop/Downloads vaults.

## State file locations

| Data                        | Path                                                  |
| --------------------------- | ----------------------------------------------------- |
| UI state, vaults, sandboxes | `~/Library/Application Support/Wenmei/state.json`     |
| Sandbox registry            | `~/Library/Application Support/Wenmei/sandboxes.json` |
| Vault metadata              | `{vault}/.wenmei/vault.json`, `journal.jsonl`         |
| File trash                  | `{vault}/.wenmei/trash/`                              |
| Pi sessions                 | `{vault}/.wenmei/pi-sessions/{sandbox-id}/`           |

## What NOT to reintroduce

Per `DEV_PLAN.md`: no Hono/tRPC, no MySQL/Drizzle, no fake DB docs, no large shadcn component dumps, no web backend build path.

## Files to touch for common changes

| Task                | Files                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Add UI component    | `src/components/*.tsx`, `src/App.tsx`                                                         |
| Add Tauri command   | `src-tauri/src/main.rs`, `src/lib/tauri-bridge.ts`                                            |
| Change state shape  | `src/store/appStore.ts`, `src-tauri/src/main.rs` (Rust `AppState`), `src/lib/tauri-bridge.ts` |
| Change Pi behavior  | `src/components/PiPanel.tsx`, `src-tauri/src/main.rs` (Pi RPC section)                        |
| Change file tree    | `src/components/FileTree.tsx`, `src-tauri/src/main.rs` (file ops)                             |
| Theme/styling       | `src/index.css`, `tailwind.config.js`                                                         |
| Keyboard shortcut   | `src/hooks/useKeyboardShortcuts.ts`                                                           |
| CLI install scripts | `scripts/wenmei`, `scripts/install-cli.sh`                                                    |
