# Wenmei Context Compact

## Identity

Project: Wenmei (`/Users/river/.openclaw/workspace/projects/wenmei`)

Product frame: agentic thinking environment for local folders. Not Obsidian alternative, not markdown editor with AI sidebar.

Core metaphor:

- Local folder = world
- Sandbox = thinking room
- Markdown = durable thinking surface
- Pi = agent inside the sandbox
- Terminal = visible CLI floor under Pi
- Wenmei = window + boundary + memory surface

## Primary Spec

`MARKDOWN_WORKSPACE_SPEC.md` is primary and has been reframed to Wenmei's new category.

`DEV_PLAN.md` is the current execution plan.

`docs/SANDBOX_HARNESS.md` explains vault/sandbox boundary.

## Current Code State

Cleaned old scaffold. The codebase is now Tauri/Vite/Rust focused.

Removed/trash:

- `api/`
- `db/`
- `contracts/`
- `src/providers/`
- `src/pages/Home.tsx`
- `src/components/ui/`
- `drizzle.config.ts`
- `.backend-features.json`
- `.env.example`
- `Dockerfile`
- `components.json`
- `info.md`
- unused `src/lib/utils.ts`
- unused `src/hooks/use-mobile.ts`

Remaining important files:

- `src-tauri/src/main.rs` — Rust desktop core
- `src/lib/tauri-bridge.ts` — frontend invoke wrappers
- `src/store/appStore.ts` — Zustand state
- `src/components/Header.tsx` — header/vault switcher
- `src/components/FileTree.tsx` — file navigation
- `src/components/CenterPanel.tsx` — markdown editor/preview/paper
- `src/components/PiPanel.tsx` — current Pi surface, still local-command transitional
- `MARKDOWN_WORKSPACE_SPEC.md` — product spec
- `DEV_PLAN.md` — next implementation plan

## Verified Commands

- `npm run check` passes
- `npm run build` passes
- `npm run lint` exits 0 with warnings only
- `cd src-tauri && cargo check` passes
- `npm run desktop:build` passes

Built app:

`src-tauri/target/release/bundle/macos/Wenmei.app`

## Architecture Decision

Step-zero Pi engine: use global Pi install via RPC.

Two Pi surfaces:

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

All programmatic/agentic Wenmei workflows should run through Pi Panel via GlobalPiRpcEngine, not Terminal mode.

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

Launch shape:

```bash
cd <active-sandbox>
/usr/local/bin/pi --mode rpc --session-dir <vault>/.wenmei/pi-sessions/<sandbox-id>
```

Global Pi is engine, not authority. Wenmei owns the world/context.

Caveat: global Pi mode is sandbox-scoped, not a true OS jail.

## Current Product Status

Working:

- Wenmei desktop app builds and was manually tested by River.
- Header/file tree/center editor/right Pi panel exist.
- Edit/preview/split/paper modes exist.
- Vault/sandbox records exist in Rust state.
- File ops exist: list/read/write/create/rename/move/delete-to-trash/pin/search.
- Cross-vault search command exists.
- Basic local PiPanel commands exist but are transitional.

Not yet done:

- startup CLI/open-path support
- native join-folder dialog
- system terminal opener
- global Pi RPC engine
- compact Wenmei settings/diagnostics only
- Finder Service
- clickable search/document links
- real Pi memory display

Settings cut:

- Wenmei should not duplicate Pi setup.
- Provider login, API keys, model config, Pi packages, and Pi extensions stay in global Pi.
- Wenmei only stores Pi path/status, shell/env behavior, trust mode, memory scope, and sandbox-local session path.

## Next Dev Order

1. CLI/open path support
2. Native join-folder dialog
3. System terminal opener
4. Pi diagnostics/settings foundation
5. GlobalPiRpcEngine
6. Finder Service script

Do not build bundled Pi sidecar yet. Do not build PTY yet. Do not reintroduce web backend.

Terminal behavior:

- Header Terminal icon sits immediately left of Paper mode.
- Clicking it opens macOS Terminal.app at active sandbox cwd.
- The Terminal session starts interactive `pi` automatically when global Pi is available.
- If Pi is missing, Terminal shows a short instruction.
- When user exits Pi, shell remains open at sandbox prompt.
- User has liberty to work/code/build/test inside sandbox from that system terminal.

## Important Philosophy

Do not control Pi's thinking. Control Pi's world.

Pi should have broad agency inside the sandbox. Wenmei should enforce boundary, context, memory location, action visibility, and trust mode.

Example future workflow: user asks Pi Panel to use global `attention-research` skill to monitor news and create a visual briefing. Pi RPC works in the sandbox, writes markdown/artifacts, Wenmei renders them aesthetically.

No bloat.
