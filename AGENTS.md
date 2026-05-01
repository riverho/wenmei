# AGENTS.md — Wenmei

> This file is for AI coding agents. It describes the project structure, conventions, and workflows you need to know before touching any code.

---

## Project Overview

**Wenmei** is a desktop "agentic thinking environment" for local markdown folders. It is a calm, folder-native workspace where markdown files on disk are the source of truth — no database, no proprietary format. It brings together a markdown editor, a file tree, a Pi (AI agent) panel, and terminal integration into a single sandbox-scoped desktop app.

Think of it as a quiet alternative to Obsidian, built as a native desktop app.

**Key architectural concepts:**
- **Vault**: a joined folder root. Markdown files stay plain files on disk.
- **Sandbox**: a scoped working boundary inside a vault, usually a folder. Commands target it without owning the whole vault.
- **Pi**: a global AI agent executable (`pi`) that Wenmei discovers and spawns in both interactive terminal mode and RPC mode.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19 + TypeScript + Vite |
| **Styling** | Tailwind CSS v3 + CSS custom properties (theming) |
| **Desktop Shell** | Tauri v2 (Rust) |
| **State Management** | Zustand (frontend), Rust `AppState` (persisted) |
| **Terminal** | `portable-pty` (Rust) + `xterm.js` (frontend) |
| **Icons** | Lucide React |
| **Build** | Vite (frontend), Cargo (Rust) |
| **Testing** | Vitest (configured, but no tests currently exist) |

---

## Directory Structure

```
wenmei/
├── src/                      # React frontend
│   ├── components/           # React components (PascalCase, default exports)
│   │   ├── Header.tsx
│   │   ├── FileTree.tsx
│   │   ├── CenterPanel.tsx
│   │   ├── PiPanel.tsx
│   │   ├── TerminalPanel.tsx
│   │   └── MobileDrawers.tsx
│   ├── hooks/                # Custom React hooks
│   │   └── useKeyboardShortcuts.ts
│   ├── lib/                  # Utilities and bridge
│   │   ├── tauri-bridge.ts   # All Tauri invoke() wrappers + TS type mirrors
│   │   └── markdown.ts       # Custom markdown parser/renderer
│   ├── store/
│   │   └── appStore.ts       # Single Zustand store
│   ├── App.tsx
│   ├── main.tsx
│   ├── App.css
│   └── index.css             # Tailwind + CSS variables for theming
│
├── src-tauri/                # Rust / Tauri desktop core
│   ├── src/
│   │   └── main.rs           # ~1,474 lines — ALL commands, state, PTY, Pi RPC
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/
│
├── docs/
│   └── SANDBOX_HARNESS.md    # Vault/sandbox boundary design doc
├── public/
│   └── logo-icon.png
├── scripts/
│   └── install-finder-service.sh
├── dist/                     # Vite production build output
└── [config files at root]
```

**Important:** The Rust backend is currently monolithic — all backend logic lives in a single file (`src-tauri/src/main.rs`). There is no module splitting yet.

---

## Build and Development Commands

### Frontend (Vite)
```bash
npm run dev         # Start Vite dev server on localhost:5173
npm run build       # Production build -> dist/
npm run preview     # Preview production build
```

### Desktop (Tauri)
```bash
npm run tauri dev       # Start Tauri in dev mode (also starts Vite dev server)
npm run desktop:build   # Build release Tauri app (triggers npm run build first)
```

### Type Checking, Linting, Formatting
```bash
npm run check       # TypeScript type check (tsc -b)
npm run lint        # ESLint on **/*.{ts,tsx}
npm run format      # Prettier --write .
```

### Rust
```bash
cd src-tauri && cargo check     # Check Rust compilation
cd src-tauri && cargo build     # Debug build
cd src-tauri && cargo build --release   # Release build
```

### Testing
```bash
npm run test        # Run Vitest once
```
> **Note:** The Vitest config looks for tests in `api/**/*.test.ts` and `api/**/*.spec.ts`, but there is no `api/` directory yet. The project currently has no tests.

---

## Code Style Guidelines

### Formatting
Prettier v3 is configured in `.prettierrc`:
- Semi-colons: **enabled**
- Trailing commas: `es5`
- Quotes: **double**
- Print width: `80`
- Tab width: `2` (spaces)
- End of line: `LF`
- Arrow parens: `avoid`

Run `npm run format` before committing.

### Linting
ESLint v9 flat config in `eslint.config.js`:
- Targets: `**/*.{ts,tsx}`
- Extends: `@eslint/js` recommended, `typescript-eslint` recommended, `react-hooks` recommended, `react-refresh` (Vite)
- Ignores: `dist/`, `src-tauri/target/**`

### Naming Conventions
- **React components**: PascalCase files + default exports (`Header.tsx`, `PiPanel.tsx`)
- **Hooks**: `use` prefix + camelCase (`useKeyboardShortcuts.ts`)
- **Zustand store**: `useAppStore`
- **Rust structs**: PascalCase (`FileNode`, `AppState`)
- **Rust commands**: snake_case (`list_files`, `save_app_state`)
- **TypeScript types/interfaces**: PascalCase, matching Rust structs where applicable

### Path Aliases
- `@/` → `src/` (configured in both Vite and tsconfig)

---

## State Management

The project uses **Zustand** with the `persist` middleware.

- **Single store**: `useAppStore` in `src/store/appStore.ts`
- **Persistence**: Partial state is saved to `localStorage` under key `wenmei-store`
- **Dual persistence**: Frontend auto-saves app state to the Rust backend via `saveAppState` / `getAppState` Tauri commands. Rust maintains the canonical `state.json` on disk.

**Store sections:**
- Layout (panel widths, open/closed, theme)
- File system (active file, file tree, open folders, pinned/recent)
- Editor state (dirty flag)
- Vault / sandbox harness
- Pi terminal messages
- Mobile drawer state

---

## Frontend ↔ Backend Communication

All communication goes through Tauri.

### Bridge File
`src/lib/tauri-bridge.ts` is the single source of truth for the frontend-to-Rust API. It exports:
- TypeScript interfaces that mirror Rust structs (`FileNode`, `Vault`, `Sandbox`, `AppPersistedState`, etc.)
- Async wrapper functions around `invoke()` for every Tauri command

### Commands (invoke)
Key command categories in `src-tauri/src/main.rs`:
- **File ops**: `list_files`, `read_file`, `write_file`, `create_file`, `create_folder`, `rename_file`, `delete_file`, `move_file`
- **Pin/Recent**: `toggle_pin`, `get_pinned_files`, `get_recent_files`
- **Search**: `search_workspace`, `search_all_vaults`
- **Vault/Sandbox**: `list_vaults`, `add_vault`, `set_active_vault`, `list_sandboxes`, `create_sandbox`, `set_active_sandbox`
- **State**: `get_app_state`, `save_app_state`
- **Terminal**: `terminal_start`, `terminal_write`, `terminal_resize`, `terminal_stop`
- **Pi Panel RPC**: `pi_panel_start`, `pi_panel_prompt`, `pi_panel_abort`, `pi_panel_restart`, `pi_panel_stop`
- **Journal**: `append_journal`, `list_journal_events`

### Events (backend → frontend)
Rust pushes events to the frontend via `app.emit()`:
- `sandbox-files-changed` — file watcher detected external changes, refresh tree
- `pi-rpc-event` — streaming AI agent response chunk
- `terminal-output` — PTY byte stream

---

## Vault / Sandbox Model

This is the core boundary model of the app. Read `docs/SANDBOX_HARNESS.md` for full details.

- **Vault**: a folder on disk. Multiple vaults can be "joined." Markdown files are plain files.
- **Sandbox**: a subfolder-scoped working context within a vault. It has its own terminal/Pi sessions and journal logging.
- **Cross-vault operations**: explicit user intent only (e.g. `/find climate --all`).

Pi commands run against the **active sandbox/vault**.

### Safety Model
- Relative paths only inside the active vault.
- Parent traversal (`..`) is rejected.
- Hidden `.wenmei/` directory is skipped in file tree and search.
- **Delete moves files to `.wenmei/trash/`**, not permanent removal.
- Mutating commands are logged to the persisted action log.

---

## Pi Integration

Wenmei does not bundle Pi. It expects a global `pi` executable (default: `/usr/local/bin/pi`).

There are two Pi surfaces:
1. **Terminal mode**: Interactive `pi` in a PTY terminal — direct human control.
2. **Pi Panel**: `pi --mode rpc` — structured agentic workflows via JSON-RPC over stdin/stdout.

**Ownership split:**
- Global Pi owns: executable/runtime, provider auth, model config, global packages/extensions.
- Wenmei sandbox owns: cwd, session dir, memory, action log, trust mode, file boundary, UI state.

Pi sessions are stored under `<vault>/.wenmei/pi-sessions/<sandbox-id>`.

---

## Theming

The app uses CSS custom properties + Tailwind `dark` class strategy.

- Light/dark themes defined in `src/index.css` via `:root` and `.dark`
- Custom Wenmei color tokens: `--surface-0`, `--surface-1`, `--text-primary`, `--accent-teal`, `--accent-rose`, etc.
- Tailwind config extends shadcn-compatible HSL variables for interoperability.
- Theme can be "system", "light", or "dark."

---

## Testing Strategy

- **Framework**: Vitest v4
- **Config**: `vitest.config.ts`
- **Environment**: `node`
- **Current status**: No tests exist. The config looks for `api/**/*.test.ts` which does not match the current project structure.

If you add tests, place them near the code they test or update `vitest.config.ts` to include the correct glob.

---

## Security Considerations

- **Path containment**: All file operations are scoped to the active vault. Paths with `..` components are rejected.
- **No network server**: This is a Tauri desktop app. There is no web server or API exposed.
- **Safe delete**: Deletions move files to `.wenmei/trash/` inside the vault rather than permanent removal.
- **Sandbox scope**: Pi runs with the active sandbox as cwd, but it is **not** a true OS jail. It is a convenience boundary, not a security boundary.
- **CSP**: Currently set to `null` in `tauri.conf.json`.

---

## Deployment

- **No CI/CD pipelines** are configured for this project.
- **No Docker** files exist.
- Desktop builds are produced locally via `npm run desktop:build`.
- macOS release bundle path: `src-tauri/target/release/bundle/macos/Wenmei.app`

---

## Files to Touch for Common Changes

| Task | Likely Files |
|------|-------------|
| Add a UI component | `src/components/*.tsx`, `src/App.tsx` |
| Add a Tauri command | `src-tauri/src/main.rs`, `src/lib/tauri-bridge.ts` |
| Change state shape | `src/store/appStore.ts`, `src-tauri/src/main.rs` (`AppState`), `src/lib/tauri-bridge.ts` |
| Change Pi panel behavior | `src/components/PiPanel.tsx`, `src-tauri/src/main.rs` (Pi RPC section) |
| Change file tree behavior | `src/components/FileTree.tsx`, `src-tauri/src/main.rs` (file ops) |
| Change theme/styling | `src/index.css`, `tailwind.config.js` |
| Add a keyboard shortcut | `src/hooks/useKeyboardShortcuts.ts` |

---

## What NOT to Reintroduce

Per `DEV_PLAN.md`, do not reintroduce:
- Hono / tRPC
- MySQL / Drizzle
- Fake DB documents
- Large shadcn component dumps
- Web backend build path

Keep it lean. This is a Tauri/Vite/Rust desktop app only.
