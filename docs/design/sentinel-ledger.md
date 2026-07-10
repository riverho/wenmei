# Design — Sentinel, Ledger, and the Orchestrator (Phase H)

**Status:** Design, 11 Jul 2026. Drives H6–H11.
**Plan ref:** [`docs/revamp-phase-improvement-plan-04Jul2026.md`](../revamp-phase-improvement-plan-04Jul2026.md) §4 Phase H.

The strategic decision: **Narrate binds to the ledger, not the wire.** This
doc specifies the three layers, the alert taxonomy, the approval relay, and
the orchestration model with its failure policy.

## 1. Three layers

| Layer | Runtime | Cost | Sees | Writes |
| --- | --- | --- | --- | --- |
| **Observer** | Rust, always on | zero tokens | PTY bytes, file changes, process state | facts → `.wenmei/journal.jsonl` |
| **Ledger** | `.agents-playbook/` per project | zero | intent: backlog, cycle brief, north star | task records (by agents, via `pb`) |
| **Analyst (Narrate)** | Pi, invoked — never streaming | metered | ledger events + redacted excerpts | reports, briefings, `memory/lessons` |

**Managed vs unmanaged gradient:** a bare folder gets observer facts only
(alerts, changesets, timeline). "Manage this project" scaffolds
`.agents-playbook/` and turns on Narrate. Narrate is a project property —
no toggle, no button.

**Write-back boundary:** Narrate may write briefings, reflections, and
`memory/lessons`; it must never mutate backlog status, acceptance checks, or
journal history. The analyst reports on the ledger; it does not cook the
books.

**Ledger union:** two event sources feed the feed and the analyst —
`.agents-playbook/memory/journal.ndjson` (intentional task records) and
`.wenmei/journal.jsonl` (observed facts). A union reader merges by
timestamp; kinds are disjoint (`task.*`/loop records vs `notification.*`,
`review.*`, `narration.*`, `files.*`).

**Drift grounding:** Narrate holds `north_star` (playbook.yaml) and the
active cycle brief (goal + stop). Drift checks compare (a) recorded actions
and (b) observed changesets against the brief — path scope, task claim, stop
condition — replacing string heuristics on terminal output.

**Token budget:** per-project `narrate_budget` (tokens/day) in the vault's
`.wenmei/` config. Analyst invocations meter against it; at 80% an alert
fires; at 100% Narrate degrades to observer-facts-only until reset or raise.

## 2. Alert taxonomy — "blocked and burning" first

An alert = actionable + time-sensitive, and carries its action when one
exists. Everything else is feed-unread, not a ping.

| Class | Kind prefix | Examples | Action attached |
| --- | --- | --- | --- |
| **Needs input** | `input.` | permission prompt, y/n confirm, OAuth URL printed, idle-at-prompt ≥ N min | Allow/Deny/Focus (H10) |
| **Quota/auth** | `quota.` | rate limit, session-limit-resets-at, expired key | Focus, docs link |
| **Safety/scope** | `safety.` | sandbox-path violation, deletion burst, `.env`/key touch, `git push`/force-push seen | Focus, review changeset |
| **Money/resources** | `resource.` | token budget 80/100%, staging cap, runaway child CPU/mem, disk low | open Settings/kill |
| **Completion** | `done.` | tests green, build finished, PR URL printed, long-silence-after-activity | open link/review |
| **Meta/system** | `system.` | control-plane client attached, sidecar crash, panic, update available | varies |
| **Ledger** | `task.` | task done/blocked, phase reflect, run card overdue | open Runs view |

Existing `notification.*` kinds (review.changes, narration.risky,
terminal.stuck/done, nightshift.*) map into these classes; `emit_notification`
gains a `class` field. Per-class user policy: OS-notify / feed-only / mute.
Dedup stays 60s per (kind, session, title).

## 3. Approval relay (H10) — alerts with hands

Mechanically, PTY input is keyboard input: a TUI cannot distinguish
sidecar-sent bytes from keystrokes. The hard part is eyes, not hands.

1. **Virtual screen:** each PTY session feeds a headless VT parser (`vt100`
   crate or equivalent) maintaining the current grid — "what is on screen
   now" as queryable text, distinct from scrollback.
2. **Prompt detection:** `AgentProfile.output_patterns` grows
   `input_patterns`: versioned regex/anchor sets recognizing actionable
   screens (Claude Code tool-permission prompt, Codex approvals, aider y/n,
   git pager). Detection emits `input.needs_response` with the prompt text
   and the profile's answer map.
3. **Alert with hands:** the card shows the *actual command/prompt* and
   buttons from the answer map (Allow → `y\r` or `\r` on selection; Deny →
   `n\r` or `\x1b`). The user's click **is** the confirmation — journaled as
   `steering.injected` with origin `approval-relay`.
4. **Verify-then-act:** hash the prompt screen region at detection; re-hash
   immediately before injection; mismatch → abort + `input.prompt_moved`
   alert. Never inject blind.
5. **Tiers:** T1 = y/n + Enter (ship first). T2 = cursor menus (needs
   cursor-position awareness). T3 = free-text responses (drafted by Narrate,
   always human-confirmed).
6. **Native adapters beat scraping:** where an agent exposes hooks/flags
   (Claude Code permission hooks → HTTP to `control.rs`), the adapter
   registers the request directly — no screen parsing. Scraping is the
   universal fallback, adapters the preferred path.
7. **Standing approvals** exist per (profile, action-class) but ship OFF;
   granting one is an explicit, journaled act (plan §0's standing-approval
   clause).

## 4. Heartbeat (H6)

`heartbeat.rs`: a native tick engine.

```rust
struct RunCard {
    id: String,
    project: String,          // vault id
    goal: String,
    wake: WakePolicy,         // Interval(secs) | OnEvent(kind) | Manual
    stop: StopCondition,      // ChecksPass(cmd) | HumanGate | Budget(tokens)
    status: RunStatus,        // idle | running | waiting_input | stuck | done | blocked
    created_at: String,
    last_tick: Option<String>,
}
```

- Persisted per project in `.wenmei/runs/*.json`; scheduler thread ticks,
  consults observer state (activity heuristics, needs-input), wakes runs,
  and speaks only through `emit_notification` (`task.` class).
- Stuck/overdue: no progress past `wake` × 3 → `task.overdue` alert.
- The heartbeat never executes work itself; it dispatches to terminals or
  the orchestrator and watches.

## 5. Orchestrator + checker (H11)

The sidecar runs the playbook loop through the control plane:

```
orient (pb status) → claim (pb next --claim) → dispatch (inject prompt /
launch workhorse in a tab) → observe (events) → verify (pb validate --task)
→ record (pb record) → repeat
```

- **Doer/checker separation:** the checker is a second, context-isolated
  agent (fresh session, no doer transcript). It reads the review ledger
  (`review.jsonl`) and the cycle brief, scores each changeset against
  *intent*, writes `review_annotate` entries, and escalates risky/ambiguous
  items to the human. Checks catch structure; the checker hunts truth.
- **Mechanical guardrails** (Rust/pb, never prompt-goodwill): record-done
  reruns checks and refuses on failure; sandbox path containment; gate tasks
  require a human-recorded entry; per-project token budget; injection
  requires confirmation or a standing approval.
- **Failure policy (written before failures):**

| Event | Policy |
| --- | --- |
| worker session dies | salvage worktree/output, journal, reassign or block |
| task checks fail ×3 | block task + `task.blocked` alert; never silent retry-forever |
| drift score ≥ threshold | pause run, `safety.drift` alert, await human |
| budget exhausted | pause run, `resource.budget` alert |
| checker flags risk | hold changeset unapproved, escalate |

- **Claim honestly:** the product promise is **supervised autonomy** —
  hours unattended, human at phase gates — not fire-and-forget weeks.

## 6. Sequencing

H6 heartbeat → H7 hardening (both feed alert classes) → H8 updater →
H9 business docs → H10 approval relay (T1) → H11 orchestrator surface.
H10/H11 runtime behavior ships behind the F10-style human validation gate:
scaffold + design land now; live keystroke injection and autonomous claiming
are enabled only after a human run.
