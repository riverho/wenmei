# Wenmei — Agentic Thinking Environment for Local Folders

Wenmei is a desktop thinking environment built on **local markdown**, **sandboxed folders**, and **Pi**.

It is not an Obsidian clone and not a web-backed notes database. Markdown files and local folders are the source of truth. Wenmei brings a calm editor, a sandbox-aware file tree, and a Pi/terminal surface into the same folder-native workspace.

## Architecture

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS
- **Desktop core:** Rust + Tauri v2
- **Communication:** Frontend calls Rust commands via `@tauri-apps/api/core` `invoke()`
- **State:** Zustand for frontend state, Rust `WenmeiState` for persisted app/vault state
- **Files:** Plain markdown files on disk — no database, no proprietary format
- **Registry harness:** A global sandbox registry authorizes folders without writing metadata into every folder
- **Vault harness:** Explicitly promoted folders get local `.wenmei/` metadata
- **Safety:** Relative path containment, action log, delete-to-trash under local or global Wenmei metadata
- **Pi direction:** Global Pi RPC as the first real engine; bundled Pi sidecar later

## Product Frame

```txt
Local folder = world
Sandbox = thinking room
Markdown = durable thinking surface
Pi = agent inside the sandbox
Terminal = visible CLI floor under Pi
Wenmei = window + boundary + memory surface
```

The OS remains the file organizer. Wenmei comes to the folder.

Target UX:

```txt
Finder folder/file → Services → New Wenmei Window
```

Then Pi and Terminal both start in that folder context.

CLI entry points:

```bash
wenmei /path/to/folder
wenmei /path/to/file.md
wenmei --new-window /path/to/folder
wenmei create /path/to/new-note.md
wenmei edit /path/to/maybe-missing.md
wenmei mkdir /path/to/new-folder
wenmei sandbox /path/to/folder
wenmei vault /path/to/folder
wenmei promote /path/to/folder
wenmei composite Project /path/to/folder-a /path/to/folder-b
```

Plain folder opens use the global sandbox registry, so Finder and CLI use do
not scatter `.wenmei/` metadata everywhere. Use `wenmei vault`, `wenmei
promote`, or the in-app **Promote** button when a folder should become a
durable Wenmei vault with local `.wenmei/` metadata.

## Project Structure

```txt
src/              React frontend
src-tauri/        Rust/Tauri desktop core
public/           static assets
MARKDOWN_WORKSPACE_SPEC.md  product spec
```

Relevant frontend files:

```txt
src/components/Header.tsx       top orientation/vault switcher
src/components/FileTree.tsx     left local file navigation
src/components/CenterPanel.tsx  edit / preview / split / paper modes
src/components/PiPanel.tsx      current Pi surface, moving toward real Pi RPC
src/store/appStore.ts           app state
src/lib/tauri-bridge.ts         Rust invoke wrappers
src/lib/markdown.ts             markdown rendering
```

## Local Setup

```bash
npm install
npm run tauri dev
```

Or run Vite separately:

```bash
npm run dev
npm run tauri dev
```

## Build

```bash
npm run desktop:build
```

Output:

```txt
src-tauri/target/release/bundle/macos/Wenmei.app
```

## Checks

```bash
npm run check
npm run lint
cd src-tauri && cargo check
```

## Rust Commands

All commands are exposed via Tauri `invoke()`:

| Command                                                    | Purpose                                               |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| `list_files`                                               | active vault markdown tree                            |
| `read_file` / `write_file`                                 | local markdown IO                                     |
| `create_file` / `create_folder`                            | local creation                                        |
| `rename_file` / `move_file`                                | local organization                                    |
| `delete_file`                                              | move to local `.wenmei/trash/` or global Wenmei trash |
| `toggle_pin`                                               | pin/unpin files                                       |
| `search_workspace`                                         | active vault search                                   |
| `search_all_vaults`                                        | explicit cross-vault search                           |
| `list_vaults` / `add_vault` / `set_active_vault`           | vault harness                                         |
| `list_sandboxes` / `create_sandbox` / `set_active_sandbox` | sandbox harness                                       |
| `get_sandbox_registry`                                     | global sandbox authorization registry                 |
| `authorize_active_workspace` / `promote_active_workspace`  | authorize or promote the current folder               |
| `get_action_log`                                           | visible mutation/action history                       |
| `get_app_state` / `save_app_state`                         | persisted app state                                   |
| `copy_file_path` / `reveal_in_folder`                      | OS integration helpers                                |

## Near-Term Pipeline

See `MARKDOWN_WORKSPACE_SPEC.md` for the full spec. Current next priorities:

1. Right-panel Sandbox Terminal / CLI Env polish
2. Global Pi RPC engine:
   ```bash
   pi --mode rpc --session-dir <sandbox>/.wenmei/pi-sessions
   ```
3. Compact settings for Pi executable, shell/env, trust mode, and memory scope
4. Clickable document/search links and diff/action UX

## Engine Ownership Split

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

Global Pi is the engine, not the authority.
