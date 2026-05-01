# Wenmei Workspace Spec

## Product Summary

Wenmei is an agentic thinking environment built on local markdown and sandboxed Pi.

It is not an Obsidian alternative. It is not a markdown editor with an AI sidebar. Markdown is the substrate, not the category.

The product brings a calm document workspace, a sandboxed command-line environment, and a real Pi agent into the same local folder. The user can open any folder or markdown file, treat it as a thinking room, and let Pi reason, write, search, code, and organize inside that boundary.

The core idea:

- local folders are the user's worlds
- sandboxes are scoped thinking rooms inside those worlds
- markdown files are durable thinking surfaces
- Pi is the agent living inside the sandbox
- terminal mode exposes the same CLI environment Pi inhabits
- Wenmei is the window, boundary, and memory surface

The OS remains the file organizer. Wenmei comes to the folder.

## Product Positioning

Wenmei sits between:

- Obsidian's local markdown ownership
- Ghostty's terminal-native posture
- Pi's lightweight agent/extensibility model

But the product category is:

> Agentic thinking environment for local folders.

The wedge is not "more note features". The wedge is:

- open any local folder as a thinking sandbox
- give Pi real agency inside that sandbox
- keep the UI calm enough for writing and reading
- preserve all work as plain files
- expose the CLI environment instead of hiding it
- let users right-click from the OS into a new Wenmei window

Wenmei should feel:

- folder-native, not database-native
- calmer than Obsidian
- lighter than an IDE
- more agentic than a text editor
- more contextual than a terminal
- more direct than a knowledge-management system

## Design Goals

1. Keep the interface readable and calm.
2. Make file location, vault, sandbox, and Pi scope obvious at all times.
3. Let the user navigate with the tree, keyboard, OS, terminal, or Pi.
4. Make the right panel a true thinking/command/terminal surface, not a second editor.
5. Let Pi operate naturally inside the sandbox instead of reducing it to rule-based commands.
6. Preserve markdown files and folders as plain files on disk.
7. Support dark and light modes that follow the system by default.
8. Make the app extensible through Pi's extension/package structure without becoming heavy.
9. Let users open Wenmei from the OS context menu on any folder/file.
10. Keep the sandbox boundary hard while allowing high agency inside it.

## Non-Goals

- No graph-first worldview.
- No decorative dashboard.
- No social feed.
- No notebook sprawl.
- No huge settings center.
- No plugin marketplace as the primary experience.
- No dependence on a proprietary document format.
- No VS Code clone.
- No Obsidian clone.
- No fake rule-based assistant pretending to be an agent.
- No terminal UI embedded for its own sake.

## Core Mental Model

The app has four visible regions and one invisible boundary model.

Visible regions:

- top: orientation and scope
- left: local navigation
- center: document work
- right: Pi / terminal / actions / memory

Boundary model:

- vault: joined local folder root
- sandbox: scoped room inside a vault
- active file: current thinking surface
- Pi session: agent memory and work stream bound to the sandbox
- terminal cwd: same sandbox root as Pi

The user should always know:

- what vault is active
- what sandbox Pi is inside
- what file is active
- what center mode is active
- whether Pi can write, run shell, or cross vaults
- where files are on disk

## Layout Spec

### 1. Minimal Header

The header is intentionally small and quiet.

Primary job:

- show where the user is
- show active vault/sandbox/file
- provide global mode and theme controls
- offer one-click access to paper mode and full-screen reading mode
- expose folder/vault switching without becoming a settings page

Header contents:

- app name: Wenmei
- active vault switcher
- breadcrumb or file path
- current document title/path
- current center mode indicator
- current Pi/sandbox scope indicator when space allows
- theme indicator or toggle
- paper/fullscreen control

Header rules:

- no dense toolbar row
- no feature pileup
- no long labels unless the viewport is wide enough
- text should be compact and always readable

The header should answer: "Where am I, and where is Pi?"

### 2. Left File Tree

The left side is an expandable file tree over the active vault/sandbox.

Primary job:

- help the user orient in the local folder
- provide rapid document switching
- expose folders, recents, favorites, and search entry points

Behavior:

- collapsed by default on narrow screens
- persistent open/closed state on desktop
- supports nested folders
- supports keyboard navigation
- supports quick create, rename, move, and delete actions
- can reveal sandbox/vault roots clearly

Tree rules:

- keep labels truncated with good hover or expanded reveal
- use indentation and disclosure states clearly
- support search without replacing the tree entirely
- show active file state unambiguously

The tree should feel like a navigator, not a heavy file manager.

### 3. Center Document Area

The center is the main thinking surface.

Modes:

- edit mode
- preview mode
- split mode
- paper mode

Edit mode:

- markdown source editing
- fast caret movement
- keyboard-first interaction
- inline formatting only where useful
- document context available to Pi

Preview mode:

- rendered markdown
- good typography
- clear headings, lists, links, code blocks, quotes, and tables
- clickable document links

Split mode:

- editor and preview visible together
- used for verification and structure checking

Paper mode:

- one-click immersive reading or writing experience
- wider margins
- reduced chrome
- stronger typography
- optional page-like width
- optional magazine-like column flow

Paper mode is not just fullscreen. It should feel like switching from an editor into a clean publication surface.

### 4. Right Panel: Pi / Actions / Memory

The right panel is the agentic environment surface.

It should support multiple modes:

- Pi: real agent conversation and work stream
- Actions: diffs, file mutations, commands, logs
- Memory: session/vault/sandbox memory surface

The right panel should behave like a thinking and execution plane rather than a second editor.

#### Pi Mode

Pi mode should eventually run a real token-backed Pi engine through Global Pi RPC, not rule-based command simulation.

Pi Panel is the integration point for structured/programmatic/agentic workflows. Terminal is the user's free direct-control surface; Pi Panel is where Wenmei drives workflows through Pi.

Capabilities:

- think with the current file
- search and reason across the sandbox
- read and write files inside the sandbox
- create new notes or project files
- rewrite and restructure documents
- code inside the sandbox when relevant
- run safe checks/commands according to the selected trust mode
- use global Pi skills, extensions, prompt templates, and packages
- run user-defined workflows through Pi RPC
- keep session memory scoped to file, sandbox, vault, or global mode

Example workflow:

```txt
User in Pi Panel:
"Use attention-research to monitor green-tech news and create a visual briefing."

Wenmei:
- starts Pi RPC in the active sandbox
- Pi uses global attention-research skill/package
- Pi writes briefing.md, sources.md, charts/, presentation.md
- Wenmei renders those files with its document/paper/magazine surfaces
```

The core rule:

> Do not control Pi's thinking. Control Pi's world.

Pi should have broad agency inside the sandbox. Wenmei should enforce the sandbox boundary, memory location, and presentation surface.

#### Terminal Mode

Terminal mode is a center workspace mode, not a right-panel mode.

It exists because Pi lives in a CLI world and because users should be able to freely work in the sandbox like they would in a normal terminal.

Purpose:

- expose the exact shell environment Pi uses
- inspect PATH, auth, node, git, pi, provider tokens
- run commands in the active sandbox cwd
- allow direct coding/work inside the sandbox
- debug why Pi can or cannot work

Expected liberty:

- the user may run normal terminal commands inside the sandbox
- the user may edit/code/build/test inside the sandbox
- Pi may also be invoked/used interactively from this terminal context when available
- Wenmei should preserve the sandbox boundary and visibility, not micromanage every terminal action

Terminal mode is not the agentic workflow engine. It is the user's free direct-control surface. Programmatic/agentic workflows belong in Pi Panel through Pi RPC.

Terminal cwd must be the active sandbox root. Terminal mode hides the right panel and uses the center canvas for focus.

First implementation may be command-console style. Later implementation can use a real PTY.

#### Actions Mode

Actions mode should show:

- files read
- files changed
- commands run
- diffs proposed/applied
- errors
- confirmations
- action log

#### Memory Mode

Memory mode should show and manage:

- current Pi session
- sandbox memory
- vault memory
- action history
- compacted summaries
- clear/export controls

## OS-Level Workflow

Wenmei should be folder-native.

Target UX:

1. User finds any folder or markdown file in Finder.
2. User right-clicks.
3. User chooses `Services > New Wenmei Window`.
4. Wenmei opens that folder/file as a sandboxed thinking environment.
5. Wenmei opens that sandbox; the Terminal button opens system Terminal at that sandbox and starts interactive Pi.

CLI target:

```bash
wenmei /path/to/folder
wenmei /path/to/file.md
wenmei --new-window /path/to/folder
```

Behavior:

- folder path: open as active vault and sandbox
- markdown file: open parent folder as vault/sandbox and select the file
- new-window: open independent Wenmei window/session for that path

Future OS-level extension:

- Quick Look preview for markdown via Space bar
- Finder service / context menu action
- document/folder association where platform allows

## Responsive Layout

### Desktop

Default desktop layout:

- left file tree visible
- center document area dominant
- right Pi panel visible but narrow
- top header minimal

Suggested proportions:

- left: 240 to 320 px when open
- right: 320 to 480 px when open
- center: flexible remainder

### Narrow Desktop / Laptop

When width is constrained:

- left tree can collapse into a rail or drawer
- right panel can become resizable or collapsible
- center stays dominant

### Mobile or Very Narrow Viewports

The app should degrade gracefully:

- header stays minimal
- tree becomes a drawer
- Pi panel becomes a bottom sheet or overlay
- center occupies the main screen

The layout must preserve orientation and access, even when panels are hidden.

## Visual Design

### Theme

Theme should follow the system by default.

Requirements:

- dark and light modes
- good contrast in both modes
- no theme that looks decorative for its own sake
- no reliance on washed-out gray text

### Readability

The typography should support long-form reading and editing.

Requirements:

- clear hierarchy
- stable line height
- comfortable paragraph spacing
- readable code blocks
- no cramped sidebar labels

### Visual Tone

The app should look like a serious working surface:

- quiet
- utilitarian
- legible
- precise

It should not feel like a marketing page.

## Feature Design

### Vaults and Sandboxes

- join local folders as vaults
- switch active vaults
- create sandbox scopes inside vaults
- bind Pi and Terminal cwd to active sandbox
- allow explicit cross-vault search/actions only
- store Wenmei metadata under `.wenmei/`

### Document Basics

- open local markdown files
- create new markdown files
- rename files
- move files
- delete files to `.wenmei/trash/`
- track recent files
- show file metadata when useful

### Markdown Editing

- plain text editing
- markdown preview
- split view
- syntax-aware highlighting
- heading navigation
- link navigation
- clickable document links
- code block support

### Search and Navigation

- full sandbox search
- full active-vault search
- explicit cross-vault search
- current file search
- command-driven navigation
- recent documents
- favorites or pinned files
- clickable search results

### Pi and Agent Features

Wenmei should use Pi as an engine, not merely imitate Pi with local rules.

There are two Pi surfaces:

```txt
System Terminal / Terminal mode
  -> human direct-control surface
  -> interactive `pi`
  -> free terminal work in sandbox

Pi Panel
  -> Wenmei workflow surface
  -> `pi --mode rpc`
  -> structured agentic workflows, skills, memory, and presentation
```

The integration point for future workflows is Pi Panel + GlobalPiRpcEngine, not Terminal mode.

Step-zero preferred engine design:

- use the user's global Pi install as the default engine adapter
- launch Pi in RPC mode from the active sandbox cwd
- use global Pi for executable/runtime, provider auth, model config, and global Pi packages
- keep Wenmei sessions, action logs, memory, and trust state inside the active sandbox under `.wenmei/`
- treat bundled Pi sidecar as a later distribution/stability path, not the initial requirement

Pi should be able to:

- summarize the current file
- rewrite sections
- extract action items
- convert notes into outlines
- generate new files from prompts
- search across sandbox/vaults
- apply repeated edits
- explain structure or content
- code inside the sandbox
- run checks/commands according to trust mode
- maintain scoped memory

Pi should not be limited to fixed slash commands in the final product. Slash commands are useful shortcuts, but natural language agent work is the primary interaction.

All structured Wenmei workflows should route through Pi Panel and Pi RPC so Wenmei can stream events, track actions, preserve sandbox memory, and render outputs aesthetically.

Core rule:

> Global Pi is the engine, not the authority. Wenmei sandbox owns the world.

### Sandbox Terminal / CLI Environment

The terminal affordance opens the user's system terminal, not an embedded terminal.

Default behavior:

- Terminal icon appears in the header immediately left of Paper mode
- clicking it opens macOS Terminal.app at the active sandbox cwd
- the launched terminal starts interactive `pi` automatically when global Pi is available
- if Pi is missing, the terminal shows a short instruction to configure global Pi
- when the user exits Pi, the shell remains open in the sandbox folder
- the user can then work/code/build/test normally in that folder

This trades strict sandbox security and integrated logging for convenience and real terminal behavior. Global Pi is sandbox-scoped by cwd, not jailed.

Terminal mode is the user's direct-control surface. Programmatic/agentic workflows belong in Pi Panel through Pi RPC.

### Settings

Settings should be small and practical. Wenmei should not duplicate Pi setup.

Because step-zero uses the user's global Pi install, provider login, model setup, packages, and Pi profile management stay in Pi itself. Wenmei only detects and uses Pi.

Required Wenmei settings:

- global Pi executable path, with auto-detect defaulting to `/usr/local/bin/pi`
- Pi availability/version/capability status
- shell path and login-shell env loading
- sandbox trust mode: ask / auto / YOLO
- write permission mode
- shell permission mode
- cross-vault permission mode
- memory scope: file / sandbox / vault / global
- session storage path under `.wenmei/`

Not in Wenmei settings:

- provider login
- API key entry
- model configuration
- Pi package management
- Pi extension configuration

If Pi is missing or not configured, Wenmei should show a clear diagnostic and a short instruction to run Pi directly, not recreate Pi's setup UI.

No giant settings center.

### Paper / Magazine Mode

Paper mode should be a first-class feature.

User intent:

- read without distraction
- write with focus
- present a document cleanly

Behavior:

- one click from anywhere
- hide most chrome
- center the document
- use a more editorial layout
- preserve exit path back to normal editing

Optional paper-mode enhancements:

- page width presets
- column presets
- reading progress indicator
- reading-time estimate
- typography presets

### File Tree Actions

The tree should support fast local actions:

- new file
- new folder
- rename
- move
- pin
- reveal in folder
- copy path

These actions should be accessible without forcing the user through dialogs for every operation.

### Extension Model

Wenmei should lean on Pi's extension/package model.

Recommended extension categories:

- writing/thinking workflows
- import/export
- sync providers
- templates
- automation commands
- formatters
- research tools
- code/document operations
- Finder/OS integrations

Preferred design:

- Pi packages expose agent capabilities
- extensions respect the local file model
- extensions run inside the selected sandbox where possible
- extensions do not take over the whole UI
- extensions are easy to disable

A marketplace is not the primary experience. The primary experience is a strong local sandbox with a real agent.

## Interaction Model

### Primary Paths

#### App-first path

1. Open Wenmei.
2. See current vault, sandbox, and file location.
3. Select a file from the tree or recent list.
4. Read or edit in the center.
5. Use Pi or Terminal in the right panel.
6. Toggle paper mode when the user wants immersion.

#### OS-first path

1. User right-clicks a folder or markdown file in Finder.
2. Selects `Services > New Wenmei Window`.
3. Wenmei opens that path as the active vault/sandbox.
4. Pi and Terminal start in that folder context.

#### Agent-first path

1. User opens a sandbox.
2. User asks Pi a natural-language task.
3. Pi reads/searches/writes/runs commands inside sandbox according to trust mode.
4. Wenmei shows actions, diffs, memory, and results.

### Keyboard-First Expectations

The app should support:

- file switching
- search
- command opening
- terminal mode toggle
- terminal focus
- tree traversal
- panel toggling
- paper mode toggle
- focus movement between left, center, and right regions

### State Persistence

Persist:

- panel open or collapsed states
- split sizes
- theme preference if user overrides system
- last active vault
- last active sandbox
- last active document
- last view mode
- tree expansion state
- Pi session pointers
- action log

## Safety and Trust

Because Pi can run actions, the app needs clear trust boundaries.

Requirements:

- sandbox path containment is enforced by Rust/core where Wenmei applies file operations
- global Pi is launched with sandbox cwd and sandbox-local session dir
- global Pi mode is sandbox-scoped, not a true OS jail
- Pi can act freely only inside active sandbox according to trust mode
- cross-vault actions require explicit intent
- destructive actions go to `.wenmei/trash/`
- show what will change before changing it when appropriate
- keep an undo/recovery path
- log agent actions
- do not hide file mutations
- keep local files as the canonical record

Trust modes:

- Ask: confirm writes/destructive commands
- Auto: auto-apply safe writes inside sandbox
- YOLO: broad agency inside sandbox, no sandbox escape

## Technical Direction

The implementation should favor a simple architecture:

- Rust/Tauri core for file operations, indexing, command execution, app state, and sandbox enforcement
- minimal React UI shell for layout and interaction
- CLI access to open folders/files into Wenmei
- sandbox terminal command runner, later optional PTY
- Pi engine abstraction with global Pi RPC as the default first implementation
- bundled Pi sidecar/SDK as the later stable distribution path
- constrained extension layer leaning on Pi packages

Engine ownership split:

```txt
Global Pi owns:
  - executable/runtime
  - provider auth
  - global model config
  - global Pi packages/extensions

Wenmei sandbox owns:
  - cwd
  - session dir
  - memory
  - action log
  - trust mode
  - file boundary
  - UI state
```

Step-zero architecture:

```txt
Wenmei Frontend
  -> Tauri Rust Core
      -> vault/sandbox/file/terminal boundary
      -> GlobalPiRpcEngine
          -> /usr/local/bin/pi --mode rpc
          -> session-dir: <vault>/.wenmei/pi-sessions/<sandbox-id>
          -> cwd: <sandbox>
          -> LLM providers via global Pi auth/config
```

Preferred later architecture:

```txt
Wenmei Frontend
  -> Tauri Rust Core
      -> vault/sandbox/file/terminal boundary
      -> BundledPiEngine
          -> Pi SDK/RPC sidecar
          -> LLM providers
```

The architecture should support shared behavior across UI, CLI, OS services, and Pi without duplicating logic.

## Pipeline

Execution detail lives in `DEV_PLAN.md`. Compact handoff context lives in `CONTEXT_COMPACT.md`.

### Current Foundation

- Wenmei desktop app builds on macOS.
- Local markdown file tree exists.
- Edit / preview / split / paper modes exist.
- Basic vault and sandbox records exist.
- Pi panel exists and has early local command wiring.
- Rust/Tauri file boundary exists.

### Next: CLI and OS Entry

- Add `wenmei /path/to/folder` support.
- Add `wenmei /path/to/file.md` support.
- Add `--new-window` support.
- Open selected path as active vault/sandbox.
- Add macOS Finder Service: `Services > New Wenmei Window`.
- Later: Quick Look markdown preview extension.

### Next: Sandbox Terminal / CLI Env

- Add center Terminal mode.
- Keep left file pane visible and hide right Pi panel while Terminal mode is active.
- Run commands in active sandbox cwd.
- Load shell environment from user login shell on macOS.
- Add diagnostics for `PATH`, `node`, `git`, `pi`, provider auth.
- Ensure Pi uses the same env as Terminal.
- Later: real PTY support.

### Next: Real Pi Engine

- Replace rule-based Pi behavior with real Pi engine integration.
- Implement `GlobalPiRpcEngine` first.
- Auto-detect global Pi executable, defaulting to `/usr/local/bin/pi` when present.
- Probe Pi version/capabilities before enabling agent mode.
- Launch Pi with active sandbox cwd.
- Use `--mode rpc` for structured streaming into Wenmei.
- Use `--session-dir <vault>/.wenmei/pi-sessions/<sandbox-id>` so memory remains vault-local and follows the folder.
- Reuse global Pi auth/model/package configuration unless user disables global profile usage.
- Stream Pi events into Pi panel.
- Support natural-language prompts, not only slash commands.
- Later: add `BundledPiEngine` using Pi SDK or internal RPC for stable distribution.

### Next: Settings

- Add compact settings panel.
- Configure Pi engine mode.
- Configure Pi executable or bundled engine.
- Configure model/provider status.
- Configure shell/env behavior.
- Configure trust mode and memory scope.

### Next: Agentic Document UX

- Clickable search results.
- Clickable document links.
- Diff preview/apply flow.
- Selection-aware Pi prompts.
- Current-file, sandbox, and vault memory display.
- Action log visibility.

### Later: Extension Ecosystem

- Support local Wenmei/Pi package discovery.
- Support project-local `.wenmei/settings.json`.
- Expose extension capabilities in Pi and UI.
- Keep extensions sandbox-aware.

## Success Criteria

The product is successful if:

- users can right-click a local folder and open a new Wenmei thinking room
- Pi can work naturally inside the sandbox with real model tokens
- the terminal and Pi share the same visible environment
- local markdown files remain the canonical record
- the UI feels calm enough for writing and reading
- the user can always orient themselves in one glance
- paper mode feels like a real reading experience
- the app stays lightweight as capabilities grow
- community Pi/Wenmei extensions can expand capability without turning the app into bloat

## Open Questions

- Should bundled Pi use SDK directly or run internal RPC?
- Should first terminal mode be command-console only or PTY immediately?
- What is the exact memory default: file, sandbox, or vault?
- How much should YOLO mode allow inside sandbox?
- Should Quick Look be bundled with the main app or shipped as a separate extension?
- Should Wenmei support multiple roots in one window or prefer one sandbox per window?
