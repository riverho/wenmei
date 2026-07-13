# Design — Changeset Review (Phase B)

**Status:** ⚠️ **Re-scoping (13 Jul 2026).** A correctness audit (see
[Audit findings & rebuild plan](#audit-findings--rebuild-plan-13-jul-2026))
found the B6 pre-image race is real in practice: baselines are captured *after*
the edit, the displayed diff is a placeholder, and pending files can vanish from
the UI. **This feature is NOT a reliable safety boundary yet** — do not present
it as one. The rebuild is sequenced below: correctness → scope/history → bind to
agent runs. Earlier notes (B1 done 07 Jul 2026; doc restored 07 Jul 2026 after
the original was lost uncommitted) kept for history.
**Plan ref:** [`docs/revamp-phase-improvement-plan-04Jul2026.md`](../revamp-phase-improvement-plan-04Jul2026.md) §4 Phase B.

Agent edits land as a reviewable changeset — per-file approve/reject against a
baseline — instead of silently mutating files. Reject restores the baseline.
Nothing is ever auto-committed.

## Baseline strategy

The goal is to make every agent edit reviewable and reversible without
duplicating the whole vault.

- A **review session** (`ReviewSession`, `rs-<epoch-ms>`) owns a staging dir
  and a map of `ChangesetEntry { path, status, size }`.
- **Git-backed vaults** (the common case for developer projects): `HEAD` is the
  immutable baseline. No files are copied into `.wenmei/staging`. Reject means
  `git checkout HEAD -- <path>`. This removes the staging-growth problem
  entirely for git repos.
- **Non-git vaults**: lazy copy-on-first-touch into
  `.wenmei/staging/<session-id>/baseline/<rel-path>`. `ensure_baseline()`
  (`src-tauri/src/review.rs`) copies the pre-image the first time a file is
  touched. Wenmei's own writes call it from hooks in `file_ops.rs` (before
  `write_file`/`rename_file`/`move_file`); external/PTY edits reach it via
  polling (`observe_external_change`).
- **Caps:** total baseline storage 200 MB per session (`STAGING_CAP_MB`);
  files >5 MB (`LARGE_FILE_MB`) are tracked but not copied — both are marked
  `ChangeStatus::BaselineMissing` so the UI can say "can't restore this one".
- **PTY pre-image race:** polling may only notice a file _after_ the agent
  changed it. For git-backed vaults this is not a race: `HEAD` is the
  pre-session state. For non-git vaults the eager full-tree snapshot was the
  mitigation, but it copies too much; the current compromise is lazy
  copy-on-first-touch with the documented caveat that very rapid external
  changes may be missed.
- Deleted files: existing delete flow already moves to `.wenmei/trash/`;
  entries with `ChangeStatus::Deleted` restore from trash, not baseline.

`ChangeStatus`: `added | modified | deleted | baselinemissing`.

## Event flow

```
Wenmei write path (file_ops.rs) ──▶ ensure_baseline(pre-image) ──▶ mutate file
External edit (PTY agent)       ──▶ polling.rs detects ──▶ observe_external_change()
                                                        │   Added/Modified/Deleted heuristic
                                                        ▼
                                     emit "changeset-updated" [ChangesetEntry]
                                                        │
                                             ReviewPanel.tsx re-renders
```

Tauri commands (`review.rs`, registered in `main.rs`):

- `review_session_start` → creates staging dir, detects git-backed vaults,
  skips copying for git repos (HEAD is the baseline), journals
  `review.session_started`, returns session id.
- `review_changeset` → current entries (poll/refresh).
- `review_approve(path)` → drop entry + its baseline copy; journals
  `review.approved`.
- `review_reject(path)` → copy baseline back over the working file, drop
  entry, journals `review.rejected`, emits files-changed so the editor reloads.
- `review_annotate(path, reviewer, risk_level, proposed_decision, annotation)`
  → appends a machine-readable Pi/agent/human review annotation to the session
  ledger without mutating files.
- `review_session_close(discard)` → clears session; `discard` deletes the
  staging dir; journals `review.session_closed`.

Journal event kinds: `review.session_started`, `review.approved`,
`review.rejected`, `review.session_closed` — appended to `.wenmei/journal.jsonl`
with source `review-panel`.

## Review ledger

Agent-to-agent review needs a structured log, not just a human-facing journal.
Every review session owns `.wenmei/staging/<session-id>/review.jsonl`. Each
line is a `ReviewLedger` JSON object with:

- `session_id`, `event`, `ts`, `path`, `status`, and `size`.
- `baseline_hash` and `current_hash` content fingerprints when the file exists.
- `restore_available`, so reviewer agents know whether reject is enforceable.
- `reviewer` (`system`, `human`, `pi`, or an agent profile id).
- `risk_level`, `proposed_decision`, `final_decision`, and `annotation`.

The ledger records session lifecycle events, detected changes, approve/reject
decisions, and annotations from `review_annotate`. The regular journal remains
the broad timeline; `review.jsonl` is the machine-readable review packet that a
sidecar or second agent can consume before escalating only risky/deferred items
to a human.

## Touch points

- `src-tauri/src/review.rs` — session lifecycle, baselines, commands (B1 ✅).
- `src-tauri/src/file_ops.rs` — pre-write `ensure_baseline` hooks (B2).
- `src-tauri/src/polling.rs` — `observe_external_change` + `changeset-updated`
  emission for external edits (B3).
- `src-tauri/src/journal.rs` — review event kinds (B4).
- `src/components/ReviewPanel.tsx` — file list, diff, approve/reject (B4).
- `src/lib/tauri-bridge.ts` — `reviewSessionStart` etc. wrappers (B5).
- `src/store/appStore.ts` — `activeReviewSession` state (B5).
- `src/App.tsx` — panel mounting.

## Run timeline

The action log surfaced first-class (plan §3.2): journal entries grouped by
review session and rendered as a per-session timeline — what the agent did to
this vault, when, and what the human approved/rejected. Lives alongside
ReviewPanel (B5). This is also the seed of the audit-export story (E2).

## Exit criterion (B6)

Run a real agent in the PTY, let it edit files, and confirm ReviewPanel shows
the changeset with working approve/reject (reject restores content). If the
pre-image race makes diffs unreliable in practice, stop and re-scope before
Phase C.

**Outcome: B6 failed as feared.** The pre-image race is real; re-scope below.

## Audit findings & rebuild plan (13 Jul 2026)

Correctness audit of the review workstream. The through-line: **baselines are
captured too late to be a safety boundary.** Keep the feature — reviewable agent
work is a real Wenmei differentiator — but rebuild the interaction model and,
first, the correctness floor.

### Findings (severity-ordered)

- **[F1 · Critical] Reject is not reliably reversible.**
  - _Non-git_: the lazy baseline is captured only when polling notices an
    external/PTY edit — at which point it copies the **already-modified** file,
    so Reject restores the modification to itself. External **deletions** have
    no baseline at all. (`review.rs:490`, `polling.rs:99`)
  - _Git_: reject uses `HEAD`, not the working-tree state when review started,
    so it can **erase pre-existing uncommitted work**. Approve a file, edit it
    again, then Reject → returns to HEAD, not the approved version.
    (`review.rs:837`)
- **[F2 · High] Save/revert race.** `savePending()` fires `writeFile()` without
  awaiting and marks its ref clean immediately. Clicking Reject blurs the editor
  first (starting that write), then runs Reject; resetting `pendingRef` can't
  cancel an in-flight write that may land **after** the restore. Needs one
  serialized save/revert coordinator. Also: the broad `catch` should clear the
  editor **only** when the rejected entry was `Added`; other read failures must
  stay visible. (`CenterPanel.tsx:44`, `ReviewPanel.tsx:169`)
- **[F3 · High] The diff is fake.** The baseline shown is a literal placeholder
  string; `simpleDiff()` compares that placeholder to the file → meaningless
  red/green under a trust-critical action. Load and render the **real**
  baseline. (`ReviewPanel.tsx:115`)
- **[F4 · High] No history / reopen.** Closing drops the only in-memory session;
  the bridge has no list/get/reopen API; the timeline is static journal text.
  "Discard" deletes staging but does **not** undo working-file changes — likely
  not what the user expects. (`review.rs:657`, `ReviewPanel.tsx:401`)
- **[F5 · High] Pending files vanish from the UI.** Polling emits only the
  latest changed batch; ReviewPanel **replaces** the whole Zustand changeset
  with that payload, so earlier unresolved files (still tracked in the backend)
  disappear from the panel. Merge, don't replace. (`polling.rs:98`,
  `ReviewPanel.tsx:99`)
- **[F6 · Medium] External-edit hardening is incomplete.** File-change events
  refresh only the tree, not the open document. The new clean-state effect helps
  explicit reloads (Reject, Cmd-R) but ordinary terminal/agent edits still leave
  a stale open editor. (`App.tsx:171`)

Meta: `source: "human"` is only journal metadata — human editor writes enter the
same review machinery as agent writes. Start silently inventories and watches
the **whole vault**. The UI exposes an internal "session" abstraction without
explaining scope or intent.

### Product direction — supervise an agent run, not your own edits

The intended user is a human **supervising an agent run**, not someone reviewing
every edit they personally type.

- Starting an agent run **auto-creates** an "Agent Changes" review.
- Manual use becomes **Checkpoint current file** (current file = default scope).
- Optional scopes: selected files → selected folder → whole vault (advanced).
- **Baselines captured before the run**: current working-tree state for git;
  eager copies for selected non-git files. PTY-wide tracking requires a real
  upfront snapshot or a copy-on-write workspace — **polling cannot reconstruct
  pre-images after the fact.**
- **Pending and History are separate.** History is read-only unless the user
  explicitly starts a new restore operation.
- Replace Close/Discard with precise actions: **Accept all**, **Revert all**,
  **Stop monitoring**. Don't allow "Finish" while files remain unresolved.
- Load and display the **real** baseline — a trust surface can't use a
  placeholder diff.

### Sequence (do in this order)

**Phase 1 — Restore correctness** (nothing ships as a safety boundary until
this lands): F1 (eager/before-the-edit baselines + deletion pre-images), F2
(serialized save/revert coordinator + scoped catch), F3 (real baseline diff),
F5 (merge changeset, don't replace).

**Phase 2 — Scope & history**: scope selector (current file → files → folder →
vault), F4 (history list/get/reopen API + read-only past reviews; redefine
Discard), Accept all / Revert all / Stop monitoring, block-finish-while-pending.

**Phase 3 — Bind to agent runs**: auto-create "Agent Changes" review on run
start, F6 (reload the open document on external edits, not just the tree),
reframe the UI around supervising a run.

### Test debt

- No Vitest frontend tests exist; the review flow is untested in the UI.
- Rust tests don't cover external-edit rejection or the save/revert race —
  add cases for F1 (non-git deletion, post-modification capture) and F2.
- `rustfmt` isn't installed, so `cargo fmt --check` can't run in this env.
