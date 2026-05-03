# Wenmei Dev Plan

## Current Frame

Wenmei is an agentic thinking environment for local folders.

- Local folder = world
- Sandbox = thinking room
- Markdown = durable thinking surface
- Pi = agent inside the sandbox
- Terminal = visible CLI floor under Pi
- Wenmei = window + boundary + memory surface

Global Pi is the step-zero engine. Wenmei sandbox is the authority/world.

## Current Verified State

- App rebranded to Wenmei.
- macOS desktop app builds: `src-tauri/target/release/bundle/macos/Wenmei.app`.
- Old web/database scaffold removed.
- Build is now Tauri/Vite/Rust only.
- `npm run check` passes.
- `npm run build` passes.
- `cd src-tauri && cargo check` passes.
- `npm run desktop:build` passes.
- `npm run lint` exits 0 with App hook warnings only.

### Live Features

- **Layout:** Header, FileTree (left), CenterPanel, PiPanel (right). Resizable panels. Mobile drawer + bottom sheet.
- **Document modes:** Edit (line numbers), Preview, Split (draggable), Paper (immersive with progress + reading time), Terminal (center mode).
- **File tree:** Nested folders, search filter, new file/folder, rename, move (modal), delete, pin, reveal in folder, copy path, context menu.
- **Theme:** System / light / dark via CSS custom properties + Tailwind.
- **Keyboard shortcuts:** Full `useKeyboardShortcuts` hook (panels, modes, terminal, search, Pi, new file/folder, theme, escape).
- **State persistence:** Zustand + Rust `AppState` dual persistence. Panel widths, open folders, theme, last file, vaults, sandboxes.
- **File operations:** Rust Tauri commands with path containment and safe-delete to `.wenmei/trash/`.
- **Search:** Active-vault and cross-vault line-by-line text search (unindexed).
- **Vault / Sandbox:** Join, switch, create sandbox, authorize/promote workspace. Metadata under `.wenmei/`.
- **Pi Panel:** Hybrid router — local slash commands for fast deterministic ops (`/format`, `/find`, `/generate`, etc.) + Pi RPC for natural language and agentic workflows. Streams `pi-rpc-event` with `text_delta`, `thinking_delta`, `toolcall_start`, `tool_execution_start/end`. File `@mentions` and clickable `@path:line` links.
- **Embedded Terminal:** `portable-pty` + `xterm.js` with login-shell env, snapshot/replay on re-open, resize observer.
- **Journal / Action Log:** `append_journal` / `list_journal_events` in Rust.
- **CLI / OS Entry:** Basic `get_initial_file` works manually from terminal. `install_cli_integration` installs shim + Finder service via `osascript`. Needs maturation.

## Architecture Decision

Use global Pi as engine first.

There are two Pi surfaces:

```txt
Terminal mode / system terminal
  -> human direct-control surface
  -> interactive `pi`
  -> free shell/coding work inside sandbox

Pi Panel
  -> Wenmei workflow surface
  -> `pi --mode rpc`
  -> structured agentic workflows, global skills, memory, and presentation
```

All programmatic/agentic Wenmei workflows should run through Pi Panel via GlobalPiRpcEngine, not through Terminal mode.

```txt
Wenmei Frontend
  -> Tauri Rust Core
      -> vault/sandbox/file/terminal boundary
      -> GlobalPiRpcEngine
          -> /usr/local/bin/pi --mode rpc
          -> cwd: active sandbox
          -> session-dir: <vault>/.wenmei/pi-sessions/<sandbox-id>
```

Ownership split:

```txt
Global Pi owns:
  executable/runtime
  provider auth
  model config
  global Pi packages/extensions

Wenmei sandbox owns:
  cwd
  session dir
  memory
  action log
  trust mode
  file boundary
  UI state
```

Important: global Pi mode is sandbox-scoped, not a true OS jail.

## Immediate Dev Sequence

### ✅ DONE — Sandbox Terminal / CLI Env

- Center Terminal mode with embedded PTY (`portable-pty` + `xterm.js`).
- Login-shell env loading (`zsh`/`bash`).
- Session snapshot/replay on re-open.
- Resize observer.

Still needed (defer to Settings phase):

- Add diagnostics for `PATH`, `node`, `git`, `pi`, provider auth.
- Ensure Pi uses the same env as Terminal.

### ✅ DONE — Pi Panel Router (Hybrid)

- `GlobalPiRpcEngine` plumbing: `pi_panel_start`, `prompt`, `abort`, `restart`, `stop`.
- JSONL stdin/stdout framing over `ChildStdin`.
- Event streaming: `pi-rpc-event` with `agent_start`, `agent_end`, `message_update` (text_delta, thinking_delta), `tool_execution_start/end`, `error`, `response`.
- Session dir: `<vault>/.wenmei/pi-sessions/<sandbox-id>`.
- Local slash commands remain as first-class router: `/format`, `/find`, `/generate`, `/summarize`, `/outline`, `/actions`, `/explain`, `/rewrite`, `/delete`, `/vaults`, `/sandboxes`, `/sandbox`, `/log`, `/journal`, `/thinking`.
- Natural-language and `@file` mentions route to Pi RPC.
- Thinking level control (`global` / `off` / `minimal` / `low` / `medium` / `high` / `xhigh`).

### 1. CLI and OS Entry (CURRENT HIGH PRIORITY)

Goal: Wenmei can open a folder/file as the active sandbox from any terminal, and eventually from the OS.

Current state: manual `wenmei /path` works from a separate terminal window. Tested with:

```bash
wenmei /Users/river/.openclaw/workspace/notes/research-v2/21st-dev.md
```

But the full installation flow and OS-level double-click are not yet mature.

Implement:

- Enrich CLI arg parsing in Rust (robust folder vs file vs flag discrimination).
- Support `--new-window` flag.
- First-run prompt to install CLI shim to `/usr/local/bin/wenmei`.
- Mature `install_cli_integration` — replace basic `osascript` with reliable install + PATH detection.
- Test end-to-end: dmg → first run → install CLI → `wenmei /path` from any terminal → correct vault + file opened.
- Polish frontend init handling for startup-selected file.

Acceptance:

```bash
wenmei /path/to/folder
wenmei /path/to/file.md
wenmei --new-window /path/to/folder
open -na Wenmei.app --args /path/to/folder
```

### 2. Native Join-Folder Dialog

Replace `window.prompt()` in `Header.tsx`.

Implement Tauri dialog open-folder flow:

- Use `@tauri-apps/plugin-dialog` from frontend or Rust command.
- Add selected path as vault.
- Set active vault.
- Refresh tree.

Acceptance:

- Header `+` opens native folder picker.
- Selecting folder opens it as active vault.

### 3. Pi Diagnostics / Wenmei Settings Foundation

Implement compact Wenmei settings and diagnostics. Do not build Pi setup inside Wenmei.

Fields:

- piPath default `/usr/local/bin/pi`
- shell path default `/bin/zsh`
- loadLoginShellEnv boolean
- trustMode: `ask | auto | yolo`
- memoryScope: `file | sandbox | vault | global`

Diagnostics command:

- `pi --version`
- `pi --mode rpc --no-session` startup probe, then terminate safely
- `PATH`, `node`, `git`

Acceptance:

- Wenmei can show if global Pi is available.
- If Pi is missing/unconfigured, Wenmei tells the user to run/configure Pi directly.
- Wenmei does not collect provider API keys, perform model login, or manage Pi packages.

### 4. GlobalPiRpcEngine — Reduce Local Dependency

As Pi's intelligence and harness maturity grow, migrate more slash commands from local handlers to Pi RPC:

- `/summarize`, `/rewrite`, `/outline`, `/explain` → Pi RPC with file context.
- `/actions` → Pi RPC extraction.
- Keep `/format`, `/find`, `/delete`, `/vaults`, `/sandboxes`, `/sandbox`, `/log`, `/journal` as local (fast, deterministic, no tokens).
- Add Pi capability probe before enabling agent mode.
- Add `BundledPiEngine` research for later stable distribution.

Acceptance:

- Pi handles open-ended tasks; local commands handle file-system bookkeeping.
- Session files land under `<vault>/.wenmei/pi-sessions/<sandbox-id>`.
- Pi-created markdown/artifacts appear in the file tree.

### 5. Pi Panel Modes + Agentic Document UX

- **Actions mode:** Diffs, file mutations, commands, confirmations, action log as a visual workflow surface.
- **Memory mode:** Session/sandbox/vault memory browser, compacted summaries, clear/export.
- **Diff preview/apply flow:** Pi proposes → Wenmei shows diff → user confirms → apply.
- **Selection-aware Pi prompts:** Highlight text in editor → ask Pi about selection.
- **Clickable search results** in Pi output.
- **Current-file, sandbox, and vault memory display** in right panel.

### 6. Search Indexing

- Current search is unindexed line-by-line walk.
- Add content indexing (e.g., `tantivy` or simple trigram index) for fast full-text search across vaults.
- Keep explicit cross-vault search opt-in.

### 7. Finder Service Script + OS Double-Click

After CLI launch path is mature:

- macOS Services > New Wenmei Window.
- Command shape:

```bash
open -na /Applications/Wenmei.app --args "$SELECTED_PATH"
```

- Document/folder association where platform allows.
- Quick Look markdown preview extension (research).

## Deliberately Deferred

- Bundled Pi sidecar.
- True OS jail/container sandbox.
- Quick Look markdown extension.
- Extension marketplace.
- Multi-root single-window workspace.
- ~~PTY terminal~~ — **Implemented. Removed from deferred.**

## Files to Touch First

### Current Priority (CLI / OS Entry)

- `src-tauri/src/main.rs` — CLI arg parsing, `get_initial_file` polish, install flow
- `src-tauri/tauri.conf.json` — deep link / URL scheme if needed
- `scripts/install-cli.sh` / `scripts/wenmei` — CLI shim maturation
- `src/components/Header.tsx` — native folder picker, install CLI button

### Next Priority (Settings + Pi Modes)

- `src-tauri/src/main.rs` — diagnostics probe, settings persistence
- `src/lib/tauri-bridge.ts` — new commands
- `src/store/appStore.ts` — settings state
- `src/components/Header.tsx` — settings trigger
- `src/components/PiPanel.tsx` — Actions/Memory modes, diff flow
- new `src/components/SettingsPanel.tsx`

### Keep Clean

- No Hono/tRPC, MySQL/Drizzle, fake DB docs, large shadcn dump, web backend path.

## Keep Clean

Do not reintroduce:

- Hono/tRPC
- MySQL/Drizzle
- fake DB documents
- large shadcn dump
- web backend build path

No bloat.
