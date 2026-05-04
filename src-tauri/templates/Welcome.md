# Welcome to Wenmei 文美🎋

Your calm, folder-native thinking environment. Markdown files stay as plain files - no database, no proprietary format.

## Getting Started
- **Papaer Mode** - `Cmd-P` or click 📖 icon on top to view document 🍬
- **Add a vault** - Click the `+` folder icon in the sidebar
- **Create notes** - Click `New file` button  `Cmd+N`. Files are plain `.md`
- **Search** - `Cmd-B` to shortlist in File Panel, or open Pi Panel and enter `/find` to search in vault
- **AI thinking** - Open a Pi panel (`Cmd+3`) to think alongside an AI on your files
- **Activate Pi Agent** - `Cmd+`` in terminal with vault folder

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

| Action | Shortcut |
|--------|----------|
| Search | `Cmd+B` |
| New file | `Cmd+N` |
| Pi panel | `Cmd+P` |
| Toggle panels | `Cmd+\` |

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

*This file lives in `~/Documents/Wenmei/` by default. Move it anywhere - Wenmei will follow.*
