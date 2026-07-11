# Design — Multi-Agent Coordination (Phase H, front-half of H11)

**Status:** Design, 11 Jul 2026.
**Plan ref:** [`sentinel-ledger.md`](sentinel-ledger.md) §5 (orchestrator + checker) — this doc adds the file-contention teeth that §5 asserted without specifying.

When Wenmei orchestrates N agents on one project, each agent's built-in
harness is a **silo**: it thinks it is alone on the filesystem. Nothing in an
agent's world tells it that three others are editing the same tree. This doc
specifies how Wenmei coordinates them safely.

## 0. Live-fire evidence (why this is real, not theoretical)

On 11 Jul 2026 four agents ran on this repo simultaneously. Observed
afterward, from a quiesced tree:

- **The coordination layer held perfectly.** `.agents-playbook/` had zero
  concurrent `in_progress` claims and `journal.ndjson` was 113 lines, 0
  malformed. The atomic-claim + append-only discipline survived four agents.
- **The filesystem layer had no boundaries.** Every change — from agents and
  from a human working in parallel — landed in **one shared uncommitted
  pile** spanning `app_design/`, `docs/`, `landing/`, and infra scripts.
  Nothing isolated whose change was whose. The next `git add -A && commit` by
  any actor would have swept everyone else's half-finished work into its
  commit.

**Correction (recorded for honesty):** an earlier draft of this doc cited the
relocation of `design-contract.yaml` (root → `app_design/`) as a *silent
agent race*. That was a misattribution — the move was a **deliberate human
action**, not an agent collision. The correct evidence is the *shared
uncommitted pile with no per-actor isolation*, which is a hazard regardless
of who authored each change. The lesson is unchanged; the example was wrong,
and the meta-lesson is real too: **ambiguous working-tree state must be
surfaced to the human, not assumed to be an agent collision.**

No corruption occurred only because the actors happened to work in mostly
disjoint areas and finished before colliding. That is luck, not design.

**The lesson in one line:** what is central and atomic (the ledger) survives
concurrency; what is shared and uncoordinated (the filesystem) does not.

## 1. The precise problem

Two coordination units exist and the gap is between them:

- **The playbook** coordinates _intent_ — `pb next --claim`, one task
  in-progress, append-only journal. It answers "who is doing which task."
- **The filesystem** is the uncoordinated shared resource.

Two agents can claim two _different_ tasks that edit the _same_ file. The
claim never touched files, so it cannot prevent that. Every downstream
symptom — write priority, stale reads, partial writes, last-writer-wins —
is one root: **the unit of coordination (task) ≠ the unit of contention
(file).**

## 2. The reframe: borrow git, do not build a lock manager

Distributed file locking across LLM agents is a trap: locks assume
participants that declare scope up front and hold it honestly. LLM agents do
neither (they discover files mid-flight and cannot be trusted to release).
Rigid locks give deadlock and starvation and fight the agent's exploratory
nature.

Two proven escape hatches, neither invented here:

1. **Isolation (git worktree per agent).** N working directories over one
   `.git`. Agents write in _different directories_, so "two agents write the
   same file" cannot happen. Contention moves to **merge**, which git has
   solved for two decades (deterministic 3-way merge, real tooling). Proven
   in this repo: the spawned UX agent ran in `.claude/worktrees/agent-…`.
2. **Optimistic + review (already built).** Agents share the vault but every
   write is baselined and lands as a reviewable changeset; a second write to
   a changed file is detected → conflict surfaced. This is git's model
   without branches.

## 3. The trust boundary (load-bearing)

Coordination **cannot** live in the agents — they are silos, cannot hold
locks, are non-deterministic. It must be **mechanical and external**,
enforced in Wenmei/`pb`/the control plane where agent goodwill is
irrelevant. Same rule as "guardrails in Rust, not prompts," applied to
concurrency. The playbook already embodies the template: **CLI-mediated,
append-only, atomic claim.**

## 4. The model — isolate the work, centralize the coordination

### 4.1 Worktree-per-agent (default for git-backed projects)

- The orchestrator creates one worktree + branch per agent
  (`git worktree add .wenmei/worktrees/<agent-id> -b agent/<task-id>`).
- The agent's harness is spawned with that worktree as cwd. It works alone,
  by construction — no shared-file race is _possible_.
- Merge is git's job; resolution runs through the checker (§4.4).

### 4.2 The ledger MUST NOT be worktree'd (the subtle trap)

If each worktree gets its own copy of `.agents-playbook/`, the **coordination
state forks**: agents claim tasks in isolated copies and don't see each
other's claims until merge — silently re-breaking the atomic-claim guarantee
that prevents task collision in the first place.

Rule: **isolate the work; centralize the coordination.**

- **Work files** → per-agent worktree.
- **Coordination state** (`.agents-playbook/` + the control plane) → one
  shared location, _above_ the worktrees, single source of truth, atomic
  claims through `pb`/the control server. Never per-worktree.

Concretely: agents claim/record against the _main_ checkout's playbook via
the control plane (`orchestrator.status` / `pb` over the plane), not against
a copy inside their worktree.

### 4.3 Scope leases (prevention at the claim layer)

Extend the claim so it reserves files, not just a task id:

- `pb next --claim` (and the orchestrator's dispatch) attaches a **path
  scope** to the task — the paths that task is allowed to touch.
- Wenmei's sandbox already does path containment; extend it to a per-agent
  **scope lease**: writes outside the lease are _rejected_, not
  detected-after. This is the "clear mind" — non-overlapping assignment up
  front. Leases are advisory-but-enforced, short-lived, and released on
  record/close.
- Overlapping scopes are the orchestrator's signal to isolate (§4.1) rather
  than share.

### 4.4 Merge through the checker, never the doer

Git gives the merge **mechanics** (conflict detection, 3-way merge); it does
**not** give **judgment**. An LLM merging its own overlapping work is the
"agent grading its own homework" problem, and prose/markdown/config conflict
is often nastier than code (no semantic merge). So:

- Integration to `main`/the vault runs through the **context-isolated
  checker** (sentinel-ledger §5): fresh session, no doer transcript, reads
  the review ledger + cycle brief, scores the merge against _intent_.
- A non-`pass` verdict holds the branch and escalates (`safety.checker_flag`).
  Isolation removes the _race_; it does not remove the _review gate_ — it
  feeds it cleaner input.

### 4.5 Non-git vaults (the knowledge-worker fallback)

Worktrees assume a git repo. Wenmei's "point it at any folder" positioning
means the later knowledge-worker tier's folders (notes, research, contracts)
are not repos. There:

- Fall back to the **review/baseline layer** (§2.2) as the coordination path,
  or a copy-on-write pseudo-worktree under `.wenmei/`.
- **Honesty:** the baseline path is **polling-based** (B3) — after-the-fact
  and itself racy (two writes between polls can miss the baseline; the B6
  pre-image race). It _detects_ collisions but cannot _prevent_ them and can
  miss some. So worktree isolation is the strong primitive for git-backed
  parallelism; the review path is the fallback, not the foundation.

## 5. Failure policy (written before failures)

| Event                                          | Policy                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| worker session dies mid-task                   | keep the worktree, journal, reassign or block (never silently discard — the dead UX-agent worktree was salvaged this way)                         |
| scope-lease conflict at claim                  | orchestrator isolates (worktree) instead of sharing, or serializes                                                                                |
| merge conflict at integration                  | checker resolves/escalates; never doer self-merge                                                                                                 |
| stale read (A reads, B edits, A writes)        | worktree makes it a merge conflict → §4.4; shared path → baseline detects                                                                         |
| contended hot file (shared config, the ledger) | short orchestrator-held advisory lease; ledger only via CLI/plane                                                                                 |
| checker flags risk                             | hold the branch unmerged, `safety.checker_flag`, await human                                                                                      |
| abandoned/stale worktree                       | orchestrator prunes on task close; `git worktree prune` on startup (the 11-Jul run left a dead worktree behind — cleanup is policy, not optional) |

## 6. Invariants (the rules that must hold)

1. Coordination state is single, central, atomic — never forked into a
   worktree.
2. Every agent write is either scope-leased (rejected if out of bounds) or
   isolated (its own worktree) — never a raw write to a shared tree.
3. Integration to the shared tree passes through the checker.
4. No agent is trusted to coordinate; enforcement is in Rust/`pb`/the plane.
5. Nothing merges to `main`/the vault without a human or a standing approval.

## 7. What is built vs. what is needed

**Built:** git-worktree isolation (proven), `.agents-playbook/` atomic
claim, review/baseline layer, sandbox path containment, control plane,
orchestrator + isolated-checker surface (H11 scaffold), per-tab PTY
isolation (H18 — N agents each in their own shell).

**Needed:**

- Orchestrator worktree lifecycle: create-per-agent, spawn-in-cwd,
  merge-through-checker, prune-on-close.
- Scope-lease extension to the claim + sandbox enforcement.
- Ledger-central enforcement: agents claim/record only via the plane, never
  a worktree-local `.agents-playbook/`.
- Non-git fallback wiring (baseline path as coordination, with its polling
  caveat surfaced to the user).

## 8. Sequencing

This is the **front-half of H11**: assigning work so it doesn't collide, and
integrating it safely, _is_ the orchestrator's core job. Build order:
worktree lifecycle → ledger-central enforcement → scope leases → merge-
through-checker. Runtime autonomous claiming stays behind the H10/H11 human-
validation gate.
