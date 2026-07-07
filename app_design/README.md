# Wenmei Design — Isolated UI/UX Playground

This is an **isolated sandbox** for designing and polishing Wenmei desktop app UI/UX without touching the live codebase.

## What's here

The complete current Wenmei design system:

- **CSS Theme** — Light/dark design tokens with warm, calm aesthetics
- **Zustand Store** — Full app state with vault/sandbox harness support
- **React Components**:
  - `Header` — Mode toggles, vault switcher, theme cycle, panel controls
  - `FileTree` — Hierarchical file browser with search, pin/recent, context menus
  - `CenterPanel` — Markdown editor with edit/preview/split/paper modes
  - `PiPanel` — AI chat with slash commands, file mentions, narration
  - `ReviewPanel` — Session-based change review with diff and timeline
  - `TerminalPanel` — Embedded PTY with xterm.js
  - `Lightbox` — Onboarding wizard and settings modal
  - `MobileDrawers` — Responsive mobile file/pi sheets
- **Keyboard Shortcuts** — Full shortcut system (Cmd+1/2/3, Ctrl+P, etc.)
- **Markdown Renderer** — Custom parser with paper mode typography
- **Tauri Bridge** — Full TypeScript interface to Rust backend
- **Mock Mode** — Browser-compatible mock implementations for testing outside Tauri

## Design Philosophy

- **Warm & Calm** — Surface colors like warm paper (#f6f4f2 light, #0f0f0f dark)
- **Teal Accent** — Primary accent (#008673 light, #00d9b5 dark) for actions/links
- **Rose for Danger** — Secondary accent (#c24a4a light, #ff6b6b dark) for destructive actions
- **Serif Display** — Playfair Display for headings gives a journal/notebook feel
- **Mono for Code** — JetBrains Mono for editor and terminal
- **Glass Morphism** — Subtle backdrop blur on Pi/Review panels

## Running

```bash
cd app_design
npm install
npm run dev        # Web dev server
npm run lint       # ESLint
npm run check      # TypeScript
npm run format     # Prettier
```

## Adding New Features

When prototyping new features:

1. Add components in `src/components/` (e.g., `NewFeaturePanel.tsx`)
2. Add state to `src/store/appStore.ts` if needed
3. Wire up in `src/App.tsx`
4. Use CSS variables from `src/index.css` for theming
5. Run `npm run lint && npm run check` before committing

## Design Tokens

```css
/* Light */
--surface-0: #f6f4f2;   /* Page background */
--surface-1: #ffffff;    /* Card/panel background */
--surface-2: #eae7e3;    /* Hover/selected background */
--surface-3: #d9d5cf;    /* Borders */
--text-primary: #111111;
--text-secondary: #5c5c5c;
--text-tertiary: #9a9590;
--accent-teal: #008673;

/* Dark */
--surface-0: #0f0f0f;
--surface-1: #141414;
--surface-2: #1a1a1a;
--surface-3: #2a2a2a;
--text-primary: #f0f0f0;
--text-secondary: #a0a0a0;
--text-tertiary: #6e6e6e;
--accent-teal: #00d9b5;
```
