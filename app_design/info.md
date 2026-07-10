# Wenmei Design System

## Overview

Complete UI/UX design sandbox for the Wenmei desktop app — an agentic thinking environment for local markdown folders.

## Design Principles

| Principle            | Implementation                                                                |
| -------------------- | ----------------------------------------------------------------------------- |
| **Warm & Calm**      | Surface colors like warm paper (#f6f4f2 / #0f0f0f) — not clinical white/black |
| **Teal Accent**      | Primary actions, links, active states (#008673 light / #00d9b5 dark)          |
| **Rose for Danger**  | Destructive actions only (#c24a4a light / #ff6b6b dark)                       |
| **Journal Feel**     | Playfair Display serif for headings; JetBrains Mono for code/terminal         |
| **Glass Morphism**   | Subtle backdrop blur on Pi/Review panels (16px blur, 140% saturate)           |
| **Micro-animations** | Panel slide-ins, paper reveal, logo glitch on hover                           |

## Color Tokens

### Light Theme

```
--surface-0: #f6f4f2   /* Page background */
--surface-1: #ffffff   /* Card/panel background */
--surface-2: #eae7e3   /* Hover/selected backgrounds */
--surface-3: #d9d5cf   /* Borders, dividers */
--text-primary: #111111
--text-secondary: #5c5c5c
--text-tertiary: #9a9590
--accent-teal: #008673
--accent-rose: #c24a4a
```

### Dark Theme

```
--surface-0: #0f0f0f
--surface-1: #141414
--surface-2: #1a1a1a
--surface-3: #2a2a2a
--text-primary: #f0f0f0
--text-secondary: #a0a0a0
--text-tertiary: #6e6e6e
--accent-teal: #00d9b5
--accent-rose: #ff6b6b
```

## Typography

| Role      | Font             | Weight  | Size                             |
| --------- | ---------------- | ------- | -------------------------------- |
| Headings  | Playfair Display | 400     | 28–38px                          |
| Body      | Inter            | 400     | 15–16px                          |
| Editor    | JetBrains Mono   | 400     | 15px / line-height 24px          |
| Terminal  | Geist Mono       | 400     | 13px / line-height 1.35          |
| UI Labels | Inter            | 500–600 | 10–12px uppercase tracking-wider |

## Components

### Header

- Logo with glitch animation on hover
- Vault switcher dropdown
- Mode toggle pills (Edit / Preview / Split)
- Agent scope indicator (rose = not authorized, teal = active, teal+check = promoted)
- Panel toggles (left/right sidebar)
- Theme cycle button (system → light → dark → ...)

### FileTree

- Hierarchical file/folder browser with chevron expand
- Search input with live filtering
- New file (+/-) buttons
- Pinned section (Pin icon, teal accent)
- Recent section (last 5 modified files)
- Right-click context menu (Pin, Move to folder, Rename, Copy path, Reveal in folder, Delete)
- In-place rename input
- Move to folder modal

### CenterPanel — View Modes

1. **Edit** — Plain textarea with line numbers
2. **Preview** — Rendered markdown
3. **Split** — Editor left, preview right, draggable divider
4. **Paper** — Full-screen immersive reading mode with zoom (Cmd+/-/0)
5. **Terminal** — Embedded PTY (xterm.js)

### PiPanel

- Glass-morphism background
- Status bar (connected/offline, thinking level)
- Message history with role differentiation (user = right-aligned, system = left)
- Message types: chat, diff (green/red line highlighting), log, confirm (with action buttons), action
- Slash command palette (`/` to open, arrow keys to navigate)
- File mention palette (`@` to open, autocomplete file paths)
- Drift alert banner with steer injection
- Narration commentary strip ("What's happening")
- Run details expandable panel

### ReviewPanel

- Tab alongside Pi in right panel
- Session start/stop controls
- Changeset list with status badges (Added/Modified/Deleted)
- Inline diff viewer
- Approve/Reject buttons per file
- Run timeline footer

### TerminalPanel

- Full-width dark terminal (#0a0d10 background)
- Activity indicator (active/idle/stuck)
- Narration toggle
- Resize-aware (ResizeObserver + xterm FitAddon)
- Session context display (cwd, log file path)

### Lightbox

- Backdrop blur overlay
- Onboarding wizard (2 pages)
- Settings modal (CLI install status)
- Slides up from bottom on mobile, centered on desktop

### MobileDrawers

- File drawer: slides in from left
- Pi sheet: slides up from bottom with drag handle

## Keyboard Shortcuts

| Shortcut             | Action                                                   |
| -------------------- | -------------------------------------------------------- |
| Cmd/Ctrl + 1         | Toggle left panel                                        |
| Cmd/Ctrl + 2         | Focus editor                                             |
| Cmd/Ctrl + 3         | Toggle right panel + focus Pi input                      |
| Cmd/Ctrl + E         | Edit mode                                                |
| Cmd/Ctrl + P         | Paper mode                                               |
| Cmd/Ctrl + Shift + P | Preview mode                                             |
| Cmd/Ctrl + `         | Toggle terminal                                          |
| Cmd/Ctrl + B         | Focus file search                                        |
| Cmd/Ctrl + K         | Command palette (Pi input)                               |
| Cmd/Ctrl + N         | New file                                                 |
| Cmd/Ctrl + Shift + N | New folder                                               |
| Cmd/Ctrl + ,         | Cycle theme                                              |
| Cmd/Ctrl + \         | Split mode                                               |
| Escape               | Exit paper/terminal mode                                 |
| Cmd/Ctrl + Shift + ` | Toggle plain terminal (narration on by default)          |
| Cmd/Ctrl + Shift + T | New terminal tab (opens terminal if not already there)   |
| Cmd/Ctrl + Shift + O | Open the active file in a new Wenmei window (sandbox on) |
| Cmd/Ctrl + Shift + , | Open Settings                                            |

### Production features (07 Jul 2026)

- **Plain terminal, narrate-on-default.** The header Terminal button and
  `Ctrl+Shift+\`` open a plain shell — no Pi seat unless narration is on.
New tabs inherit the `Narrate new tabs by default` preference
  (Settings › Terminal), which ships **on**.
- **Terminal tabs.** `TerminalPanel` renders a tab strip (`TerminalTabBar`)
  with per-tab narrate dot, close buttons, a `+` (`Ctrl+Shift+T`), and a
  memory readout (`N/limit tabs · ~MB`). Tabs are capped by
  `terminalTabLimit` unless `Unlimited tabs` is enabled; the `+` disables at
  the cap. (Playground keeps one xterm shared across tabs; each tab is a
  separate PTY in the real app.)
- **Multi-window.** File context menu → `Open in new window` (or
  `Ctrl+Shift+O`) spawns a window that carries its own sandbox scope.
  `ChildWindowLayer` renders draggable, closable window mocks
  (traffic-light chrome, `Sandbox on` badge). Governed by
  `New windows open with sandbox on` (Settings › Windows).
- **Settings.** Sidebar layout (`SettingsPanel`) with sections: General,
  Terminal, Windows, Keyboard, Agent & Narration, Integrations, License,
  About. Reusable primitives: `Toggle`, `SettingRow`, `Segmented`,
  `SettingsSectionHeader`.
- **Notifications.** The old `Ctrl+1/2/3` header hint is replaced by a
  `Notifications` bell (unread badge + dropdown). Items are typed
  (review / narration / agent / system) and dismissible; store holds the
  list with `addNotification` / `markNotificationsRead` /
  `dismissNotification` / `clearNotifications`.
- **Sidecar in terminal.** The right panel (Pi/Review) is no longer forced
  closed or hidden in terminal mode — it opens on demand via the header
  toggle or `Ctrl+3`, so narration commentary can sit alongside the shell.
- **Keyboard settings.** Settings › Keyboard lists every shortcut grouped;
  click any chord to rebind (records the next combo, Esc cancels, Reset
  restores defaults). Playground-only capture — not persisted to real
  keymaps.

## Animation System

```css
/* Panel slide-ins */
.animate-header-slide {
  animation: header-slide-down 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.animate-left-panel {
  animation: left-panel-slide 0.7s 0.1s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.animate-right-panel {
  animation: right-panel-slide 0.6s 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.animate-paper-reveal {
  animation: paper-reveal 0.5s 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

/* Logo glitch on hover */
.logo-glitch:hover {
  animation: wenmei-text-glitch 2.5s steps(10, end) infinite;
}

/* Cursor blink for Pi terminal streaming */
.cursor-blink {
  animation: cursor-blink 530ms infinite;
}
```

## Custom Scrollbar

```css
.wenmei-scroll::-webkit-scrollbar {
  width: 6px;
}
.wenmei-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.wenmei-scroll::-webkit-scrollbar-thumb {
  background: var(--surface-3);
  border-radius: 3px;
}
.wenmei-scroll::-webkit-scrollbar-thumb:hover {
  width: 10px;
  background: var(--text-tertiary);
}
```

## Markdown Preview Classes

| Class                  | Description                                    |
| ---------------------- | ---------------------------------------------- |
| `.md-h1` – `.md-h6`    | Serif headings with proper spacing             |
| `.md-p`                | Body paragraphs (16px, line-height 1.7)        |
| `.md-blockquote`       | Teal left-border quote block                   |
| `.md-pre` / `.md-code` | Code blocks with syntax-bg background          |
| `.inline-code`         | Inline code (teal color, surface-2 background) |
| `.md-table-wrap`       | Scrollable table wrapper                       |
| `.md-task`             | Task list checkbox (accent-teal)               |
| `.prose-paper .*`      | Enhanced typography for paper mode             |

## Running

```bash
npm install
npm run dev        # Start web dev server
npm run lint       # ESLint
npm run check      # TypeScript
npm run format     # Prettier
```

## Mock Mode

When running `npm run dev` (outside Tauri), all backend calls fall through to `src/mocks/mock-bridge.ts` — a complete in-browser mock of the Rust backend including file system, Pi RPC, and terminal.

### Phase H direction (11 Jul 2026) — master control

- **Narrate binds to the ledger, not the wire.** SidecarFeed header shows
  `Managed · .agents-playbook` (project property, no toggle) or
  `Watching · Manage this project` (observer facts only; click scaffolds a
  playbook). Pi is engage-on-demand (`Pi idle · start` pill) — opening a
  terminal never starts it.
- **Terminal decoupled.** Per-tab narrate dots/toggles removed; the tab dot
  is a plain session indicator.
- **VaultMenu** replaces the `<select>`: switch with active check, `+ Add
  folder`, per-vault `−` soft-remove (disabled on active), per-vault `Open
  in new window` (separate instance mock via ChildWindowLayer), and a
  `Manage vaults` link into Settings.
- **Settings › Vaults**: multi-select list, select-all, add/remove many.
  Removal is a soft detach from state.json — files never touched, nothing
  to archive.
- **Settings › Windows** gains `Multiple app instances` (one window per
  vault; single-instance lock removed).
