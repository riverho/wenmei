---
description: Entry point for operating the Agent-Playbook loop. Teaches agents to orient on playbook.yaml, select tasks, follow skills/processes, verify with executable checks, record, and report.
---

# Playbook Skill — read this first

This is the entry point for **any** agent working in this folder. It teaches you how to operate the playbook so every agent behaves the same way and the work loops without friction.

> The master is `playbook.yaml`. It is the fixation — the single anchor everything points back to. If anything here disagrees with `playbook.yaml`, the master wins.

## Startup (do this every session)

1. Read `playbook.yaml` — the master: index, loop contract, guardrails, paths.
2. Read `memory/project-memory.md` — durable operating rules and project facts.
3. Run `node scripts/pb.mjs status` — orient on backlog + recent journal + guardrail state.

(First time on a fresh clone, run `npm install` once, then `node scripts/pb.mjs bootstrap`.
Use `node scripts/pb.mjs init` only to hydrate missing runtime files.)

## The loop (one command per step)

Repeat this until the backlog is clear:

| Step      | What                          | Command                                                                                                                         |
| --------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1. Orient | Re-anchor + snapshot state    | `node scripts/pb.mjs status`                                                                                                    |
| 2. Select | Pick + claim the next task    | `node scripts/pb.mjs next --claim` — refuses if there's no active loop or the cycle brief is missing/stale; `--force` overrides |
| 3. Act    | Follow the skill → process    | open `skills/<skill>/SKILL.md`, then `processes/<process>.yaml`                                                                 |
| 4. Verify | Structure + the task's checks | `node scripts/pb.mjs validate` then `validate --task <id>`                                                                      |
| 5. Record | Log the outcome (enforced)    | `node scripts/pb.mjs record --task <id> --action <a> --status <done\|blocked> --notes "..."`                                    |
| 6. Report | Roll up for humans            | `node scripts/pb.mjs report`                                                                                                    |

Then go back to step 1.

## Done is enforced, not declared

A task's `acceptance_checks` are **shell commands** (cwd = playbook root, exit 0 = pass).
`pb next` prints them when you claim; `pb validate --task <id>` runs them on demand;
`pb record --status done` re-runs them and **refuses to record** if any fail.

> **Paths are relative to the playbook root** — the folder containing `playbook.yaml`,
> not the outer workspace. If the playbook is installed at `.agents-playbook/`, write
> `Test-Path artifacts/X.md`, **not** `Test-Path .agents-playbook/artifacts/X.md` (that
> resolves to `.agents-playbook/.agents-playbook/...` and fails on a file that exists).
> `pb validate --task <id>` warns when a check names the playbook folder.

- If checks fail: fix the work, or record `--status blocked` with notes on what's needed.
- `--skip-checks` exists as an escape hatch, but the skip is stamped on the journal entry
  and flagged in reports. Don't use it to fake green.
- A task without checks is verified on your honor only. When you write a task, give it
  executable checks whenever possible — exit codes, not prose.

## Skills-first routing

1. `pb next` tells you which `skill` a task uses.
2. Open that skill in `skills/<id>/SKILL.md`. It points to a canonical process in `processes/`.
3. Follow the process steps. Only improvise when **no** skill fits.
4. If you had to improvise something reusable, **write a new skill + process** and add them to
   `skills/index.yaml` and `processes/index.yaml`. That is how the playbook learns.

## Guardrails (lightweight)

- `pb validate` must stay green. It checks that the master, indices, and every referenced file
  exist and parse; that skills point to real processes; that backlog statuses, dependencies,
  and journal JSON are well-formed.
- Record every iteration with `pb record` — no silent work. Never hand-edit `memory/journal.ndjson`.
- One task `in_progress` at a time. Stay inside this folder.

## Agent-first, human-second

You work against machine records:

- **Backlog** (`memory/backlog.yaml`) — what to do.
- **Journal** (`memory/journal.ndjson`) — what happened (append-only, via `pb record`).

Humans read the rollups you generate with `pb report` in `artifacts/reports/`. The journal is the
source; the report is the artifact. Keep doing the work in the loop and the reports take care of themselves.

## Adding to the playbook

- **New task** → add an item to `memory/backlog.yaml`, with executable `acceptance_checks`.
- **New repeatable workflow** → add `processes/<id>.yaml` + register in `processes/index.yaml`,
  then `skills/<id>/SKILL.md` + register in `skills/index.yaml`.
- **New durable fact** → add a numbered rule to `memory/project-memory.md`.
- Run `pb validate` after any change.

## The phase loop (cycle → reflect)

The task loop above runs _inside_ a larger phase loop. The **North Star** (`north_star` in
`playbook.yaml`) is the invariant goal, re-injected every turn by `pb anchor`. Each phase also has a
changing **cycle goal**:

- **Open a phase:** `pb cycle --new` writes `memory/cycle.md` — five questions (goal, foreseen and
  prior challenges, stop condition, and any conflict with your own memory). `pb anchor` re-injects the
  goal and stop condition every turn.
- **Close a phase:** `pb reflect` reviews what was recorded `done` since the last reflection against
  the North Star and records it. `pb checkpoint` warns on a missing/stale brief or on N tasks done
  without a `pb reflect`.
- **Enforced, not just warned:** `pb next --claim` refuses to claim a task if there's no active loop,
  no cycle brief, the brief's Q5 (memory-conflict check) is still the unfilled placeholder, or the
  brief was left stale by a later `pb reflect`. Fix the precondition, or override with `--force`
  (not recommended — it claims despite the gap).

**Memory precedence:** on project matters this folder (`north_star` + `memory/`) outranks your own or
host memory. Host memory is the past; the playbook is the present and future. On conflict, surface it
— never silently follow host memory.

## Loop epochs and learning

For scoped work, open a durable epoch with `node scripts/pb.mjs loop new --goal "..." --stop "..."`.
New records are stamped with the active `loop_id`; long-running commands should use
`node scripts/pb.mjs run -- <command>` so logs and PIDs are tied to that loop.

- **Continuing** (default): the new loop inherits the existing backlog as-is — use this when the
  remaining `todo` tasks still match the current repo state.
- **Ground-up** (`loop new --fresh`): use this when the backlog is stale relative to disk (e.g. it
  assumes earlier "done" tasks/artifacts that no longer exist, or paths that moved). `--fresh`
  archives the current backlog to the new loop's artifacts dir (nothing is lost) and resets
  `memory/backlog.yaml` to empty, so old tasks can't be silently claimed under the new loop. Add
  tasks that reflect the current repo state afterward.
- Clean close: `node scripts/pb.mjs loop close --status done`.
- Contaminated close: `node scripts/pb.mjs loop close --status failed --reason "..."`.
- Smarter next loop: after a failed loop, record user/agent reflection with
  `node scripts/pb.mjs learn --loop <id> --source user --notes "..."` before opening the next loop.

Promote reusable lessons into `memory/project-memory.md`, backlog tasks with acceptance checks, or
new/updated skills and processes. Keep raw details in `memory/lessons.ndjson`.
