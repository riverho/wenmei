# Wenmei🎋文美  — A markdown workspace with an AI that lives in your folder

Wenmei is a desktop thinking environment built on **local markdown**, **sandboxed folders**, and **Pi-AI Agent**.

Markdown files and local folders are the source of truth. Wenmei brings a calm editor, a sandbox-aware file tree, and a Pi/terminal surface into the same folder-native workspace.

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

## Product Use Case

```txt
Local folder = Sandbox = The thinking room for AI Agent
Markdown = Durable thinking surface that connects thoughts of yours
Pi Panel = Liberty to organize thoughts, folders and researches
Terminal Mode = The liberty of CLI terminal for more agentic workflow
Wenmei = window + boundary + memory surface
```


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

Hacker version aims to open source with MIT License.
