# Welcome to Wenmei

Your calm, folder-native thinking environment. Markdown files stay as plain files - no database, no proprietary format.

## Getting Started

- **Add a vault** - Click the folder icon in the sidebar, or drag any folder onto the window
- **Create notes** - Right-click a folder -> New file. Files are plain `.md`
- **Search** - Press `Cmd+K` to search across all vaults
- **AI thinking** - Open a Pi panel (`Cmd+P`) to think alongside an AI on your files

## How it Works

**Vaults** are folder roots. Everything inside a vault is local-first.

**Sandboxes** are scoped workspaces inside a vault - each has its own terminal, Pi session, and journal.

**Safety** - Wenmei hides `.wenmei/` from file trees and moves deleted files to `.wenmei/trash/`.

## Local Metadata

Wenmei creates a hidden `.wenmei/` folder for local vault metadata:

```text
.wenmei/
|-- vault.json
|-- journal.jsonl
|-- trash/
|-- terminal/
|   `-- logs/
`-- pi-sessions/
    `-- default-root/
        |-- terminal/
        `-- panel/
```

You usually do not need to edit these files directly. They are hidden from Wenmei's file tree and search.

## Quick Reference

| Action        | Shortcut |
| ------------- | -------- |
| Search        | `Cmd+K`  |
| New file      | `Cmd+N`  |
| Pi panel      | `Cmd+P`  |
| Toggle panels | `Cmd+\`  |

## Keyboard Navigation

- `Up` / `Down` - navigate file tree
- `Enter` - open file
- `Space` - Quick Look preview after installing QLMarkdown
- `Escape` - close panels / cancel

## Next Steps

1. **Add your first vault** - point it at an existing notes folder, or start fresh
2. **Try the terminal** - `Cmd+P` opens a Pi session inside the active sandbox
3. **Explore** - right-click files for context menu actions

---

_This file lives in `~/Documents/Wenmei/` by default. Move it anywhere - Wenmei will follow._
