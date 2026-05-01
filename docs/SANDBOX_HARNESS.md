# Wenmei Vault + Sandbox Harness

## Intent

Wenmei borrows VS Code's workspace boundary idea without becoming an IDE.

- **Vault**: an explicitly promoted folder root. Markdown files stay plain files on disk, with Wenmei metadata in local `.wenmei/`.
- **Sandbox**: a scoped working boundary, usually a folder. Commands can target it without owning the whole vault.
- **Registry**: global Wenmei metadata that records authorized sandboxes and recent documents without writing `.wenmei/` into every opened folder.
- **Cross-vault operation**: explicit user intent only, e.g. `/find climate --all`.

This keeps the app calm for normal writing while allowing power-user workflows when the user joins multiple folders.

## Current harness in code

Rust/Tauri core now owns the desktop boundary:

- `list_vaults`
- `add_vault`
- `set_active_vault`
- `list_sandboxes`
- `create_sandbox`
- `set_active_sandbox`
- `search_workspace`
- `search_all_vaults`
- `get_action_log`
- `get_sandbox_registry`
- `authorize_active_workspace`
- `promote_active_workspace`

Pi command surface wired now:

- `/find <term>` searches active vault
- `/find <term> --all` searches all joined vaults
- `/vaults` lists joined folders
- `/sandboxes` lists scoped sandboxes
- `/sandbox <name>` creates a root sandbox mock in active vault
- `/generate <prompt>` creates a markdown file
- `/format` mutates active file directly through Rust
- `/delete` moves the active file to vault trash after confirmation
- `/log` shows file action log

## Safety model

- Relative paths only inside active vault.
- Parent traversal (`..`) is rejected.
- Hidden `.wenmei/` is skipped in file tree/search.
- Delete means move to local `.wenmei/trash/` for promoted vaults or global Wenmei trash for registry sandboxes, not permanent removal.
- Mutating commands log to persisted desktop state.

## Metadata placement policy

Wenmei has three open levels:

```txt
document
  -> single file, no sandbox authority, global recent-document record only

sandbox
  -> folder is authorized in the global registry
  -> Pi/Terminal may run inside that folder
  -> no local .wenmei/ is created

vault/promoted
  -> folder is authorized in the global registry
  -> local .wenmei/ is created for durable vault metadata
```

This keeps markdown default-app behavior clean: opening random notes or
folders from Finder does not flood the filesystem with identical metadata.
Promotion is an explicit trust and persistence step.

## VS Code idea we keep

VS Code's useful idea is not the heavy UI. It is the boundary:

```txt
window/workspace
  -> folders
  -> trust boundary
  -> commands run against selected scope
```

Wenmei version:

```txt
app
  -> vaults
  -> sandboxes
  -> Pi commands run against active sandbox/vault
  -> cross-vault only when explicit
```

## Next UI step

The UI does not need a big settings screen. Add a small vault switcher in the header:

```txt
Wenmei / ActiveVault / path/to/file.md
          [switch] [join folder]
```

And a compact sandbox strip in Pi:

```txt
Scope: Root sandbox ▾
```

That is enough. No dashboard.
