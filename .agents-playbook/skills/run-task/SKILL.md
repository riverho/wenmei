---
name: run-task
description: Execute a generic backlog task by making the smallest change that satisfies the task's acceptance checks.
---

# Run Task

Use this skill for **any** backlog task that does not have a more specific skill. It is the default unit of work for the loop.

Canonical process: `processes/run-task.yaml`

## When to use

- You ran `pb next` and the task's `skill` is `run-task` (or has no skill).
- The work is a one-off that doesn't justify its own process yet.

## Core rules

- Re-anchor to `playbook.yaml` first — it is the fixation.
- The task's `acceptance_checks` (shell commands) ARE the definition of done. Do the **smallest** change that makes them exit 0.
- Stay inside the repo and playbook folder.
- Record the outcome with `pb record` before claiming the next task. Recording done re-runs the checks and refuses if they fail.

## Steps

1. **Orient** — `pb status`; read `memory/project-memory.md`; read the task's checks.
2. **Plan** — name the smallest change and the files you'll touch.
3. **Execute** — do the work.
4. **Verify** — `pb validate` + `pb validate --task <id>`.
5. **Record** — `pb record --task <id> --action execute --status done --notes "<what+why>"`.
6. **Report** — `pb report` when a batch is complete.

## If the task is bigger than one process step

Write a dedicated process in `processes/`, add it to `processes/index.yaml`, add a skill in `skills/` and `skills/index.yaml`, then route to it. Growing the playbook is part of the job.
