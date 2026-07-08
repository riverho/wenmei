# Design — Unified Sidecar Feed (Phase F)

**Status:** Design, 07 Jul 2026. Drives F2–F7.
**Plan ref:** [`docs/revamp-phase-improvement-plan-04Jul2026.md`](../revamp-phase-improvement-plan-04Jul2026.md) §4 Phase F.

The sidecar becomes the single pane of glass: one chronological, filterable,
long-scrolling feed in the right panel that interleaves everything the two
intelligences produce — chat, narration, alerts, review events — instead of a
Pi-chat view with bolted-on strips.

## Event taxonomy

Every feed item normalizes to:

```ts
interface FeedItem {
  id: string; // stable — journal ts+kind or message id
  ts: string; // RFC3339
  class: "chat" | "narrate" | "alert" | "review";
  title?: string; // alerts only
  text: string;
  sessionId?: string; // terminal tab that produced it (narrate/alert)
  kind?: string; // journal kind for review/alert drill-down
  unread: boolean;
}
```

| class     | Contents                                             | Live source                        | Persisted as                    |
| --------- | ---------------------------------------------------- | ---------------------------------- | ------------------------------- |
| `chat`    | user ↔ Pi work messages                              | Pi RPC stream (`pi-rpc-event`)     | Zustand `piMessages` (last 200) |
| `narrate` | digest summaries, drift flags, per tab               | `narration-digest` (+`session_id`) | journal `narration.digest`      |
| `alert`   | notifications — see kinds below                      | **new `wenmei-notification`**      | journal `notification.*`        |
| `review`  | changeset trail: session started, approved, rejected | `changeset-updated` + journal      | journal `review.*`              |

### Alert kinds (F2 backend contract)

`emit_notification(state, app, kind, title, body, session_id, metadata)` in
`journal.rs`:

1. Appends journal event `notification.<kind>` (source `notifier`).
2. Emits `wenmei-notification` `{ kind, title, body, session_id, ts }`.
3. If the window is unfocused, fires an OS notification via
   `tauri_plugin_notification` (already initialized in main.rs).

Call sites and kinds:

| kind                                     | Fired from                           | Example                           |
| ---------------------------------------- | ------------------------------------ | --------------------------------- |
| `review.changes`                         | review.rs (changeset grew)           | "3 files changed by agent"        |
| `narration.risky`                        | narration/PiPanel drift or risk flag | "Risky change flagged"            |
| `terminal.stuck`                         | terminal.rs activity heuristic       | "zsh 2 stuck 20 min"              |
| `terminal.done`                          | terminal exit                        | "zsh 2 finished"                  |
| `nightshift.done` / `nightshift.blocked` | nightshift.rs                        | "Night shift staged 3 changesets" |
| `system`                                 | anything else (updates, errors)      | "Sidecar offline"                 |

Dedup rule: identical `(kind, session_id, title)` within 60s collapses into
the prior alert (counter bump), so a stuck terminal doesn't spam.

## Long scrolling & hydration

The journal **is** the persistence — no second store.

- On open, the feed hydrates the newest page from `list_journal_events`
  (extend the command with `before: Option<String>` cursor + `limit`).
- Scroll-up at the top loads the next older page (page size 50) and prepends.
- Live events append at the bottom; auto-stick to bottom only when the user
  is already there (same rule chat UIs use).
- Rendering is windowed: only the visible slice ± overscan mounts (simple
  index-window, no dependency).
- `chat` items merge from `piMessages` by timestamp; they are not journaled
  (privacy: prompts stay out of the vault journal).

## Filters

Chip row pinned under the panel tabs:

`All · Chat · Narrate · Alerts · Review` — single-select, `All` default.

- Chips show unread badges per class (`Alerts (2)`).
- When terminal mode is active with >1 tab, a secondary tab-scope dropdown
  narrows `narrate`/`alert` items to one `sessionId`.
- Filter is client-side over the hydrated window; paging continues to fetch
  unfiltered pages (the journal cursor stays simple) and filters on render.

## Unread & the bell (F7)

- `lastSeenTs` per class in Zustand; items newer than it are unread.
- An "— new —" divider renders at the unread boundary when the panel opens.
- Header bell = unread `alert` count. Click → open right panel, select the
  feed, apply the Alerts filter, scroll to the divider (deep-link). A hover
  dropdown previews the latest 5 alerts with per-item dismiss (playground
  design carries over).
- Opening the feed with a class visible marks that class seen after 1.2s.

## Layout

```
┌─ Right panel ────────────────┐
│ [Pi] [Review]   ← panel tabs │
│ ┌─ chips ─────────────────┐  │
│ │ All Chat Narr Alrt Revw │  │
│ ├─────────────────────────┤  │
│ │  ▲ older (scroll-up)    │  │
│ │  [review] rs-123 opened │  │
│ │  [narrate·zsh1] It ran… │  │
│ │  [chat] user: draft a…  │  │
│ │  ── new ──              │  │
│ │  [alert] 3 files changed│  │
│ ├─────────────────────────┤  │
│ │  composer (chat input)  │  │
│ └─────────────────────────┘  │
└──────────────────────────────┘
```

The composer stays pinned at the bottom in every filter — the feed is where
you read; the composer is how you direct. Drift/steer cards and pending
injection confirmations render inline in the feed as `narrate`-class items
with action buttons (existing PiPanel behavior, relocated).

## Terminal tabs ↔ narration (F3/F4 contract)

- `terminal.rs` keeps `HashMap<String, TerminalSession>`; commands take
  `session_id` (default session id `"t1"` preserves backward compat).
- Each session owns its `NarrationBuffer`; `narration-digest` and
  `terminal-output` payloads carry `session_id`.
- New tabs inherit `narrate_by_default` from settings (ships **on**).
- Feed `narrate` items render a small `zsh 1` chip; clicking it focuses that
  terminal tab.

## Settings touchpoints (F6)

Machine-level, persisted in `AppState`/`state.json`: `narrate_by_default`,
`terminal_tab_limit`, `terminal_tabs_unlimited`, `sandbox_new_windows`,
`narration_depth`, `license_key/tier`. UI-level, persisted in Zustand:
theme, keymap, panel layout, `lastSeenTs`.

## Non-goals

- No notification center window; the feed is the center.
- No server push, no cross-device sync — local events only.
- Chat history stays out of `journal.jsonl`.
