# Design — Changeset Review (Phase B)

**Status:** In progress (B1 done 07 Jul 2026); doc restored 07 Jul 2026 after
the original was lost uncommitted.
**Plan ref:** [`docs/revamp-phase-improvement-plan-04Jul2026.md`](../revamp-phase-improvement-plan-04Jul2026.md) §4 Phase B.

Agent edits land as a reviewable changeset — per-file approve/reject against a
baseline — instead of silently mutating files. Reject restores the baseline.
Nothing is ever auto-committed.

## Baseline strategy

Lazy copy-on-first-touch into `.wenmei/staging/<session-id>/baseline/<rel-path>`:

- A **review session** (`ReviewSession`, `rs-<epoch-ms>`) owns a staging dir
  and a map of `ChangesetEntry { path, status, size }`.
- `ensure_baseline()` (`src-tauri/src/review.rs`) copies the pre-image the
  first time a file is touched. Wenmei's own writes call it from hooks in
  `file_ops.rs` (before `write_file`/`rename_file`/`move_file`); external/PTY
  edits reach it via polling (`observe_external_change`).
- **Caps:** total baseline storage 200 MB per session (`STAGING_CAP_MB`);
  files >5 MB (`LARGE_FILE_MB`) are tracked but not copied — both are marked
  `ChangeStatus::BaselineMissing` so the UI can say "can't restore this one".
- **PTY pre-image race:** polling may only notice a file _after_ the agent
  changed it. Mitigation: `review_session_start` eagerly snapshots existing
  visible files recursively at session start, excluding dot-directories and
  `.wenmei/`.
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

- `review_session_start` → creates staging dir, snapshots md pre-images,
  journals `review.session_started`, returns session id.
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
