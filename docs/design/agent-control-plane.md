# Design — Local Agent Control Plane (Phase B2)

**Status:** Draft for implementation, 07 Jul 2026.
**Plan ref:** `docs/revamp-phase-improvement-plan-04Jul2026.md` §3.5 and
Phase B2.

Wenmei should not rely on agents clicking the GUI. The app should expose a
local, governed control plane so workhorse agents can update app state, request
human approval, annotate review findings, and drive validation through the same
rules the UI uses.

## Goals

- Let an external agent or script control a live `.app` instance.
- Keep the GUI as the visible source of truth: status cards, review changes,
  approvals, and timeline entries update from structured agent events.
- Reuse app-owned review, terminal/sandbox, journal, and ledger code paths.
- Make B6 validation repeatable without brittle desktop click automation.

## Trust Boundary

- Bind only to `127.0.0.1` or a Unix socket.
- Generate a per-run `token`.
- Write discovery metadata to `wenmei-control.json`.
- Require the token on every request.
- Journal meaningful control actions.
- Require explicit UI policy before destructive cross-sandbox commands or PTY
  injection. Phase B2 only exposes review and bounded sandbox validation
  commands.

Initial discovery file:

```json
{
  "version": 1,
  "url": "http://127.0.0.1:49321",
  "token": "per-run-token",
  "pid": 12345
}
```

Preferred locations, in order:

1. Active vault: `.wenmei/wenmei-control.json`
2. App support fallback: `~/Library/Application Support/Wenmei/wenmei-control.json`

## Protocol

The first implementation can use one JSON endpoint:

```http
POST /rpc
Authorization: Bearer <token>
Content-Type: application/json
```

Request:

```json
{
  "id": "agent-generated-id",
  "command": "review.changeset",
  "params": {}
}
```

Response:

```json
{
  "id": "agent-generated-id",
  "ok": true,
  "result": {}
}
```

Errors are JSON:

```json
{
  "id": "agent-generated-id",
  "ok": false,
  "error": "No active review session"
}
```

## Core Objects

```text
AgentSession
- id
- name
- kind: claude-code | codex | aider | pi | custom
- sandbox_id
- terminal_id
- status: idle | running | waiting_for_input | blocked | done | error
- current_task
- last_seen_at

AgentEvent
- agent.started
- agent.status.updated
- agent.output_digest
- agent.file_changed
- agent.review.annotation
- agent.approval.requested
- agent.steering.suggested
- agent.done
- agent.error

AgentCommand
- app.status
- review.start
- review.changeset
- review.annotate
- review.approve
- review.reject
- review.ledger
- sandbox.run
- terminal.start
- terminal.type
- terminal.narrate
- terminal.snapshot
- ui.status.update
- approval.request
```

## Phase B2 Commands

`app.status`
: Return active vault, sandbox, review session presence, and app version.

`review.start`
: Start a review session through the same review module used by the UI.

`review.changeset`
: Return current `ChangesetEntry[]`.

`review.annotate`
: Append a `ReviewLedger` annotation with `reviewer`, `risk_level`,
`proposed_decision`, and `annotation`.

`review.approve` / `review.reject`
: Apply the same approve/reject semantics as `ReviewPanel`.

`review.ledger`
: Read `.wenmei/staging/<session-id>/review.jsonl` for the active session.

`sandbox.run`
: Execute a bounded shell command in the active sandbox cwd. Return
`stdout`, `stderr`, and `status`. The file poller remains responsible for
detecting changes and feeding the review session.

`terminal.start`
: Start a governed PTY session for the active sandbox and selected agent
profile. Params include `agent` or `profile_id`, optional `command`, and
optional `cwd` relative to the vault. The command returns a `terminal_id`,
initial status, and the resolved profile etiquette. This command is the control
plane equivalent of opening the terminal UI; it must reuse the app's terminal
session registry and journal the launch.

`terminal.type`
: Queue text for the active or specified `terminal_id`. Params include `text`,
`origin`, and optional `submit` (default `true`). This is an automation entry
point into the Phase C steering path, so it must follow the same profile
etiquette and approval policy as UI steering. For C6 validation, the expected
policy is explicit human-approved injection unless the app is launched in a
test-only automation mode that records the bypass in the journal.

`terminal.narrate`
: Return recent narration/digest entries for the active terminal, including
busy/idle state, last output summary, drift flags when present, and any
pending steering suggestion. This gives the control-plane test a structured
way to wait for "agent is ready" without scraping PTY bytes.

`terminal.snapshot`
: Return a bounded snapshot of terminal state: `terminal_id`, profile,
status, cwd, recent output tail, last narration digest, and pending injection
cards. Snapshots are for validation and debugging; they must not mutate PTY
state.

## `wenmeictl`

`wenmeictl` is a thin JSON client over the control plane, not a parallel path.

Expected shape:

```bash
wenmeictl status
wenmeictl review start
wenmeictl sandbox run "printf 'changed\n' > docs/nested.txt"
wenmeictl review changeset --json
wenmeictl review annotate docs/nested.txt --reviewer pi --risk low --decision reject --note "nested file changed"
wenmeictl review reject docs/nested.txt
wenmeictl review ledger --json
wenmeictl terminal start --agent codex
wenmeictl terminal type --origin draft-prompt "Summarize docs/nested.txt"
wenmeictl terminal narrate --json
wenmeictl terminal snapshot --json
```

The CLI discovers `wenmei-control.json`, sends the token, and prints JSON by
default so agents can assert outcomes.

## B6/B2 Review Validation Flow

1. Launch the fresh `.app` against a temp vault.
2. `wenmeictl status` confirms the app and active vault.
3. `wenmeictl review start`.
4. `wenmeictl sandbox run "printf 'changed nested content\n' > docs/nested.txt"`.
5. Wait for polling, then `wenmeictl review changeset --json`.
6. `wenmeictl review annotate docs/nested.txt --reviewer pi --risk low --decision reject --note "..."`
7. `wenmeictl review reject docs/nested.txt`.
8. Confirm file content restored and `wenmeictl review ledger --json` contains
   `session_started`, `change_observed`, `annotation`, and `decision`.

## C6 Terminal Automation Validation Flow

The C6 exit test should be repeatable through `wenmeictl` without desktop click
automation. The GUI remains visible and authoritative; the control plane drives
the same terminal, narration, and steering paths the UI uses.

1. Launch Wenmei against a temp vault with the C6 test policy selected.
2. `wenmeictl status --json` confirms the active vault, sandbox, and control
   plane token.
3. `wenmeictl terminal start --agent codex --json` starts a PTY-backed agent
   session and returns a `terminal_id`.
4. `wenmeictl terminal snapshot --terminal <id> --json` confirms the profile,
   cwd, and terminal status.
5. Draft the workhorse prompt through the Pi/steering surface, then inject it
   with `wenmeictl terminal type --terminal <id> --origin draft-prompt "..."`.
   In normal mode this creates a pending confirmation card; in C6 automation
   mode the test harness may approve it through the documented test policy and
   must leave an auditable journal entry.
6. Poll `wenmeictl terminal narrate --terminal <id> --json` until narration
   reports the agent is idle or waiting for input.
7. Trigger a drift scenario and verify narration exposes the drift flag and
   steering suggestion.
8. Send the steering correction with
   `wenmeictl terminal type --terminal <id> --origin drift-alert "..."`, again
   using the same confirmation or test-policy path.
9. `wenmeictl terminal snapshot --terminal <id> --json` confirms the PTY
   received both injections, the terminal is still usable, and pending
   injection state is clear.
10. Confirm the journal contains `terminal.started`, `terminal.typed` or
    `steering.injected`, narration/drift records, and any explicit automation
    approval records required by the selected C6 policy.

## Non-Goals For B2

- No remote access.
- No unaudited GUI automation.
- No automatic approval of destructive actions.
- No full MCP adapter until the JSON command shape is stable.
