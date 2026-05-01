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

### 1. App launch path / CLI open support

Goal: Wenmei can open a folder/file as the active sandbox.

Implement:

- Parse startup args in Tauri/Rust.
- Support folder path: open as active vault + sandbox.
- Support markdown file path: open parent folder as active vault/sandbox and select file.
- Support `--new-window` later if simple; otherwise defer.
- Add frontend init handling for startup-selected file.

Acceptance:

```bash
open -na Wenmei.app --args /path/to/folder
open -na Wenmei.app --args /path/to/file.md
```

### 2. Native join-folder dialog

Replace `window.prompt()` in `Header.tsx`.

Implement Tauri dialog open-folder flow:

- Use `@tauri-apps/plugin-dialog` from frontend or Rust command.
- Add selected path as vault.
- Set active vault.
- Refresh tree.

Acceptance:

- Header `+` opens native folder picker.
- Selecting folder opens it as active vault.

### 3. Open Sandbox Terminal via system Terminal

Use the user's system terminal as the default tradeoff. Do not build integrated PTY or command-console now.

Implement:

- Add Terminal icon in header immediately left of Paper mode.
- Clicking Terminal opens macOS Terminal.app at the active sandbox cwd.
- The launched terminal starts interactive `pi` automatically when global Pi is available.
- When the user exits Pi, the shell remains open in the sandbox folder.
- If Pi is missing, show a message in the terminal explaining how to configure global Pi.

Expected liberty:

- User gets a real terminal experience immediately.
- User can use interactive Pi normally.
- User can code/build/test inside the sandbox.
- User can exit Pi and continue with normal shell commands in the same sandbox.
- Wenmei trades strict sandbox security for convenience here; global Pi is sandbox-scoped by cwd, not jailed.

Acceptance:

- Terminal button opens Terminal.app.
- Terminal cwd is active sandbox path.
- Terminal runs `pi` automatically if available.
- After exiting Pi, terminal stays open at sandbox shell prompt.

### 4. Pi diagnostics / Wenmei settings foundation

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

### 5. GlobalPiRpcEngine

Implement real Pi RPC streaming.

Rust side:

- Spawn global Pi process with strict cwd and session dir.
- JSONL stdin/stdout framing.
- Keep process lifecycle per active sandbox/session.
- Abort/stop support.

Frontend side:

- Send natural language prompt from PiPanel.
- Stream assistant text/events into PiPanel.
- Allow Pi to use global skills/extensions/packages in the sandbox context.
- Keep existing local commands as fallback only.

Acceptance:

- User types natural language into PiPanel.
- Wenmei streams real Pi answer.
- Pi can invoke global skills, e.g. attention-research, from panel workflow.
- Session files land under `<vault>/.wenmei/pi-sessions/<sandbox-id>`.
- Pi-created markdown/artifacts appear in the file tree and can be rendered by Wenmei.

### 6. Finder Service script

After launch path works:

- Add a script/doc for macOS Services > New Wenmei Window.
- Command shape:

```bash
open -na /Applications/Wenmei.app --args "$SELECTED_PATH"
```

Acceptance:

- Right-click folder/file can open Wenmei sandbox.

## Deliberately Deferred

- Bundled Pi sidecar.
- True OS jail/container sandbox.
- PTY terminal.
- Quick Look markdown extension.
- Extension marketplace.
- Multi-root single-window workspace.

## Files to Touch First

- `src-tauri/src/main.rs`
- `src/lib/tauri-bridge.ts`
- `src/store/appStore.ts`
- `src/components/Header.tsx`
- `src/components/PiPanel.tsx`
- possibly new `src/components/TerminalPanel.tsx`
- possibly new `src/components/SettingsPanel.tsx`

## Keep Clean

Do not reintroduce:

- Hono/tRPC
- MySQL/Drizzle
- fake DB documents
- large shadcn dump
- web backend build path

No bloat.
