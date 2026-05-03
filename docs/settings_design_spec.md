# Settings Lightbox — Design Spec

## Intent

Settings should use the same lightbox foundation as onboarding, but it should not imply unfinished features are live. For now, only the CLI installation control is functional. Everything else is a visible placeholder that documents the intended information architecture.

This keeps the UI reviewable while preserving product honesty.

## Entry Points

- Header/settings trigger: future explicit settings button or command.
- Native menu: `File > Settings` should open the same lightbox.
- Keyboard: `Cmd+,` should eventually open Settings instead of cycling theme.

React entry:

```tsx
openLightbox("settings", "Settings", "lg");
```

Tauri native menu target:

```text
File > Settings
  -> emit "open-settings"
  -> App.tsx listens
  -> openLightbox("settings", "Settings", "lg")
```

## Current Implementation Rule

Only one row is active:

- CLI integration: status check, install action, installed state, path/error/result text.

Everything else is a disabled or placeholder row:

- Sandbox
- Agent scope
- Appearance
- Reading / Paper mode
- Vaults and workspace
- Privacy / data
- Diagnostics

Do not add fake toggles, fake selects, or fake buttons that look operational.

## Layout

Use the existing lightbox chrome:

- `variant = "settings"`
- `size = "lg"`
- Header title: `Settings`
- Body padding: same rhythm as onboarding (`p-8`, compact rows)
- Sections are vertical groups with small section labels and rounded rows.

Structure:

```text
Settings
System integrations
  [CLI integration]                    Active
  [Finder service]                     Placeholder
  [Quick Look markdown preview]        Placeholder
  [Pi runtime]                         Placeholder

Workspace & agent
  [Agent scope]                        Placeholder
  [Sandbox]                            Placeholder
  [Vault metadata]                     Placeholder

Reading & appearance
  [Theme]                              Placeholder
  [Paper width]                        Placeholder
  [Default document mode]              Placeholder

Data & diagnostics
  [State storage]                      Placeholder
  [Logs]                               Placeholder
  [Reset onboarding]                   Placeholder
```

## Row Design

Each row should have:

- Left icon, 32px square, muted surface.
- Title, 12px semibold.
- Description, 10px muted.
- Optional status text or badge.
- Optional action button only when the action is real.

Placeholder rows should show a muted `"Planned"` badge, not a disabled primary button.

Example placeholder row:

```text
[icon] Sandbox
       Active sandbox selection and per-sandbox defaults.
                                      Planned
```

## Functional Row: CLI Integration

Purpose:

- Detect whether `wenmei` CLI is installed.
- Show installed path when available.
- Install CLI and Finder service through the existing backend command.

Current APIs:

```ts
cliIntegrationStatus();
installCliIntegration();
```

States:

| State      | UI                                |
| ---------- | --------------------------------- |
| checking   | Button text `Checking`, disabled  |
| absent     | Button text `Install`, enabled    |
| installing | Spinner + `Installing`, disabled  |
| installed  | Button text `Installed`, disabled |
| error      | Inline small rose error text      |
| success    | Inline small teal result text     |

## Placeholder Sections

### System Integrations

Rows:

- CLI integration: active now.
- Finder service: planned separate status/install row.
- Quick Look markdown preview: planned status/install row.
- Pi runtime: planned detection of global `pi`, version, auth/provider readiness.

### Workspace & Agent

Rows:

- Agent scope: planned display for `openMode`, `metadataMode`, `sandboxAuthStatus`.
- Sandbox: planned active sandbox selector and sandbox root display.
- Vault metadata: planned status for local `.wenmei/` vs global registry metadata.

### Reading & Appearance

Rows:

- Theme: planned system/light/dark segmented control.
- Paper width: planned fixed/percentage width control.
- Default document mode: planned edit/preview/split default.

### Data & Diagnostics

Rows:

- State storage: planned links or reveal actions for state paths.
- Logs: planned open diagnostics/log folder.
- Reset onboarding: planned action to mark `onboarding_completed = false`.

## Native Menu Plan

Add a Tauri app menu with at least:

```text
File
  Settings...
```

Behavior:

1. User chooses `File > Settings`.
2. Rust receives menu event.
3. Rust emits `open-settings`.
4. React listener opens the Settings lightbox.

Frontend listener should live near other app-level event listeners in `App.tsx`.

Mock/browser mode can test this with:

```ts
window.dispatchEvent(new CustomEvent("open-settings"));
```

## Acceptance Criteria

- [ ] Header no longer shows `Install CLI`.
- [ ] Settings lightbox has the real CLI integration row.
- [ ] Planned sections are visible but clearly non-operational.
- [ ] No fake controls appear clickable.
- [ ] `File > Settings` opens the same lightbox once native menu is added.
- [ ] `Cmd+,` can be reassigned to Settings after native menu support lands.
