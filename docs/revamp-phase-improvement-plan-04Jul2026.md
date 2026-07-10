# Wenmei Revamp — Phase Improvement Plan

**Date:** 7:25pm, 07 Jul 2026
**Status:** Vision / planning draft
**Author:** River + Claude

---

## 0. Thesis

Wenmei stops being "a markdown editor with an AI" and becomes:

> **The safe desktop where AI agents do real work on your files — visible, reviewable, reversible.**

Every powerful agent is a terminal. **Wenmei gives it a manager.**

The core pattern is a **blackboard architecture** — two intelligences of
different kinds working the same shared surface (the folder):

| Role              | Surface                    | Character                                                                                                                                                                      |
| ----------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Workhorse**     | PTY terminal               | Any CLI agent (Claude Code, Codex, Aider, Pi interactive, …). Freeform, powerful, opaque. Does the heavy lifting.                                                              |
| **Sidecar**       | Pi `--mode rpc` (JSON-RPC) | Structured, programmatically drivable, always-on. Doesn't do the work — _understands_ the work.                                                                                |
| **Shared memory** | The sandbox/vault folder   | Both see the same files. `sandbox-files-changed` events + action log let the sidecar observe everything the workhorse does, without the workhorse cooperating or even knowing. |

The asymmetry — one raw channel, one structured channel, both grounded in the
same disk — is the whole product.

The next architectural step is not "automate the GUI with clicks." It is a
**local Agent Control Plane**: Wenmei exposes a governed, local-only protocol
that lets workhorse agents update app state, request approvals, annotate
changes, and steer their own visible run cards. The GUI becomes the live console
for agent labor; agents do not scrape it, they participate in it.

### Why this wins

- CLI agents are exploding, but they're built by developers for developers.
  Consultants, researchers, lawyers, analysts, writers will never live in a
  terminal. Cursor won this bet for code; nobody has won "Cursor for
  documents/knowledge work."
- Model vendors are racing each other to zero on the workhorse layer. Nobody
  owns the layer above it — **supervision, memory, trust, review** — because it
  requires being local, agent-neutral, and file-native. Wenmei is accidentally
  all three.
- Agent-agnostic = we capture the switching-cost layer (memory, review
  workflow, audit trail, chief of staff) while agents commoditize each other.
  When a better CLI agent ships next quarter, users point a PTY at it; their
  everything-else stays in Wenmei.
- Local control plane = agents can operate Wenmei _through Wenmei's rules_.
  They can update status, annotate review findings, request human sign-off, and
  receive decisions without needing brittle GUI automation or vendor-specific
  hooks.

### What we deliberately do NOT do

- Compete on editor features (Obsidian has a decade head start).
- Build sync/collab/web backend — destroys local-first differentiation and the
  zero-infra cost structure (also forbidden by DEV_PLAN.md).
- Bundle or bet the identity on Pi specifically — Pi is the default sidecar
  engine, not the product identity.
- Auto-commit anything. Nothing an agent does becomes permanent without a human
  or an explicit standing approval.

---

## 1. The assets we already have

Strip away "markdown editor" and the repo already contains the bones of an
agent cockpit:

- **Sandbox boundaries** — folder-scoped permission model (relative-path
  containment, `..` rejected, `.wenmei/` hidden).
- **Action log + delete-to-trash** — audit trail and undo layer for agent
  actions (`.wenmei/trash/`).
- **Two agent surfaces** — PTY terminal (`Terminal`) and structured RPC
  (`PiPanel`), watching the same folder.
- **Live file-change events** — `sandbox-files-changed` lets the UI (and the
  sidecar) react as the agent edits files.
- **Review ledger** — `.wenmei/staging/<session-id>/review.jsonl` is the
  machine-readable review packet: file status, hashes, restore capability,
  reviewer, risk, proposed/final decision, and annotation text.
- **No lock-in** — plain files, agent-agnostic harness; nothing in the PTY path
  is Pi-specific.
- **Vault metadata dir** — `.wenmei/` is the natural home for sidecar memory,
  journals, and staged changesets.

---

## 2. The four levels of the dream

### Level 1 — The Translator

The sidecar narrates the workhorse in human language.

- Tee `terminal-output` (and `sandbox-files-changed`) into the Pi RPC session
  as observations.
- Pi produces a running plain-language commentary in the sidebar: _"It
  refactored the billing module across 6 files. Two are risky — it changed a
  date calculation you didn't ask about."_
- Non-developers can suddenly _employ_ developer-grade agents because someone
  in the room speaks both languages.

**This alone is a paid product.**

### Level 2 — The Navigator

Pair programming, both seats AI, the human sets the destination.

- **Prompt crafting:** user tells Pi what they want in plain language; Pi
  crafts the actual prompt and types it into the PTY (keystroke injection
  through the existing PTY handle).
- **Drift detection:** Pi watches the workhorse wander and steers it — _"You're
  rewriting the config loader; the task was the parser. Refocus."_ — injected
  straight into the terminal.
- **Intent review:** Pi reviews every changeset against the user's _intent_,
  not just correctness: "It did what it said, not what you meant. Reject files
  3 and 4?"

The human stops **operating** the agent and starts **directing** it.

### Level 3 — The Chief of Staff

The sidecar becomes persistent in a way workhorses never are.

- **Institutional memory:** Pi maintains the vault journal in `.wenmei/` —
  what was tried, what failed, what the human rejected and why. On a fresh
  workhorse session, Pi briefs it by pasting context into the PTY. Agent
  memory solved not with a vector DB but with a librarian.
- **The foreman:** multiple PTY tabs, different agents on different subfolders
  (the sandbox model already scopes this). Pi tracks all of them: "Terminal 2
  finished; terminal 1 has been stuck in a test loop for 20 minutes — kill and
  retry with a different approach?"
- **Adversarial QC:** workhorse A writes; Pi feeds the output to workhorse B
  for critique; Pi synthesizes the disagreement for the human. One-click
  adversarial review.
- **The night shift:** user leaves a task list in `TODO.md`; Pi runs the
  workhorse through it overnight — every changeset staged for morning review,
  nothing auto-committed. Wake to a briefing, not a mess.

### Level 4 — The Employment Layer

Wenmei is no longer an app; it's the employment layer for AI labor.

- The **folder** is the office. **Workhorse agents** are contractors —
  interchangeable, hired per-task. **Pi** is the chief of staff who onboards,
  briefs, watches, and reports. **The human** is the executive who sees
  briefings and signs off.
- Wenmei owns supervision, memory, trust, and review across _all_ agents.

---

## 3. Product features that fall out of the levels

1. **Diff-review UX** (highest value, build first as a surface): agent edits
   land as a reviewable changeset — approve/reject per file — instead of
   silently mutating files. Converts fear into trust; trust is what
   non-developers pay for. Builds on `sandbox-files-changed` + action log +
   trash.
2. **Run history / timeline:** the action log surfaced first-class — "what did
   the agent do to this vault, when, and why." Doubles as the compliance story
   (audit export later = enterprise checkbox).
3. **Agent-agnostic harness:** any CLI agent that runs in a PTY works. Agent
   profiles (launch command, prompt-injection style, known output patterns)
   instead of a hardcoded `pi` assumption.
4. **Recipes / scheduled runs:** "every Monday, summarize this folder into
   `weekly-review.md`"; "watch `inbox/`, file new PDFs with a note."
   Repeatable agent jobs on folders = the recurring-revenue justification.
5. **Memory surface browser:** agent workspaces (Claude Code projects, OpenClaw
   workspaces, memory dirs) are piles of markdown nobody has a good viewer
   for. Wenmei as _the_ browser for agent memory/sessions — the wedge into the
   early-adopter crowd who will evangelize it.
6. **Local Agent Control Plane:** a local-only bridge that lets agents connect
   to the running app, update GUI state, request approvals, annotate review
   items, and receive human decisions. This is the substrate beneath steering,
   foreman mode, night shift, and repeatable validation.

---

## 3.5. Local Agent Control Plane

The control plane is the "real deal" version of an agent-friendly CLI. A CLI is
useful, but only as one client. The product primitive is a local bridge inside
Wenmei that external agents and sidecars can speak to.

### Principles

- **Local-only:** bind to a Unix socket or `127.0.0.1`; never expose a network
  service by default.
- **Token-gated:** each app run creates a short-lived control token stored under
  app support and optionally mirrored into the active vault's `.wenmei/`
  metadata for trusted local agents.
- **Same rules as the UI:** bridge commands call the same review, terminal,
  journal, and sandbox code paths as the React UI. No hidden bypasses.
- **Human-confirmed power:** destructive actions, PTY injection, standing
  approvals, and cross-sandbox operations require explicit policy or UI
  confirmation.
- **Event-first GUI:** agents can push structured status, risk, approval, and
  progress events. Wenmei renders them as live cards and timeline entries.
- **Plain-file audit:** every meaningful bridge action lands in the journal,
  review ledger, or vault memory. The bridge is observable by default.

### Surfaces

| Surface                   | Role                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Wenmei control server** | Local JSON-RPC/MCP-compatible service owned by the running app. Holds app state, sessions, active vault, policy, and event stream. |
| **Agent adapter**         | MCP server, JSON-RPC client library, or tiny wrapper that lets Claude Code/Codex/Aider/Pi call Wenmei tools.                       |
| **`wenmeictl` CLI**       | Thin fallback client for scripts and tests. It talks to the same control server; it is not the core architecture.                  |
| **GUI console**           | Live dashboard for connected agents, task state, review cards, approval requests, drift alerts, and human decisions.               |

### Core Objects

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
- review.start
- review.changeset
- review.annotate
- review.approve
- review.reject
- terminal.write
- terminal.run
- ui.card.create
- ui.status.update
- approval.request
```

### Agent-Facing Tools

The first bridge can expose tools like:

```text
wenmei.open_vault(path)
wenmei.start_review()
wenmei.get_changeset()
wenmei.annotate_change(path, risk, summary, proposed_decision)
wenmei.request_human_approval(title, body, options)
wenmei.reject_change(path)
wenmei.update_agent_status(status, current_task)
wenmei.append_timeline_event(kind, summary)
wenmei.type_into_terminal(text)
```

`wenmeictl` should be implemented as a small client over the same protocol:

```bash
wenmeictl review start
wenmeictl terminal run "printf 'changed\n' > docs/nested.txt"
wenmeictl review changeset --json
wenmeictl review annotate docs/nested.txt --reviewer pi --risk low --decision reject
wenmeictl review reject docs/nested.txt
wenmeictl review ledger --json
```

### Why It Matters

- Agents can update the GUI directly with structured, reviewable intent.
- Desktop validation becomes repeatable without brittle click automation.
- Phase C steering becomes a bridge command plus a confirmation policy, not a
  one-off terminal hack.
- Phase D foreman and night shift become natural extensions of connected
  `AgentSession`s.
- The human reviews exceptions, decisions, and policy changes instead of
  manually reading every terminal line.

---

## 4. Phased roadmap

### Phase A — Feel the magic (1–2 weeks, one experiment)

Goal: prove Level 1 narration feels magical before investing further.

- [ ] Tee the PTY `terminal-output` stream into the active Pi RPC session as
      observation messages (rate-limited / chunked).
- [ ] Feed `sandbox-files-changed` events to the same session.
- [ ] Pi sidebar renders a running commentary panel ("What's happening")
      alongside the existing chat.
- [ ] Kill switch: narration is opt-in per terminal session.

Touch points: `src-tauri/src/main.rs` (event tee), `src/lib/tauri-bridge.ts`
(new command/flag), `src/components/PiPanel.tsx` (commentary UI),
`src/components/` terminal component (opt-in toggle).

**Exit criteria:** running Claude Code in the PTY on a real folder while Pi
narrates feels clearly better than reading the terminal. If not, stop and
re-scope.

### Phase B — Trust surface (3–5 weeks)

Goal: reviewable, reversible agent work. The core paid feature.

- [ ] **Changeset staging:** snapshot-on-session-start (or copy-on-write into
      `.wenmei/staging/`) so agent edits can be diffed against a baseline.
- [ ] **Diff review panel:** per-file approve/reject; reject = restore from
      baseline (reuse trash/restore machinery).
- [ ] **Run timeline:** action log rendered as a session timeline in the UI.
- [ ] Pi annotates the diff: risk flags, plain-language summary per file
      (Level 2 intent review, read-only version).
- [ ] **Machine-readable review ledger:** every review session writes
      `.wenmei/staging/<session-id>/review.jsonl` with hashes, restore
      capability, reviewer identity, risk, proposed/final decisions, and
      annotations. This makes agent-to-agent review practical.
- [ ] **Exit validation:** run a real agent in the desktop PTY, confirm the
      Review panel catches nested/non-markdown mutations, reject restores the
      baseline, and `review.jsonl` records the decision.

### Phase B2 — Local Agent Bridge (1–2 weeks)

Goal: make the running desktop app controllable by agents through a governed
local protocol, not through GUI scraping.

- [ ] Add a local-only control server inside the app (`127.0.0.1` or Unix
      socket) with a per-run token and explicit trust boundary.
- [ ] Expose the Phase B review surface as bridge commands:
      `review.start`, `review.changeset`, `review.annotate`,
      `review.approve`, `review.reject`, `review.ledger`.
- [ ] Expose agent session/status events so connected workhorse agents can
      update the GUI: current task, running/blocked/done, risk flags, approval
      requests, and timeline entries.
- [ ] Add `wenmeictl` as a thin JSON-first client for scripts and validation.
      It must use the same bridge as agents, not a parallel code path.
- [ ] Add an MCP-compatible adapter once the JSON-RPC shape is stable, so
      agents can call Wenmei tools directly.

**Exit criteria:** an external agent or script connects to a live `.app`, opens
a test vault, starts review, mutates a file through terminal/sandbox commands,
annotates the changeset, requests human approval, rejects or approves a file,
and the GUI updates live while the journal/review ledger record every step.

### Phase C — Hands on the wheel (3–4 weeks)

Goal: Level 2 steering.

- [ ] `pi_type_into_terminal`-style command: sidecar (with user confirmation)
      injects text into the PTY. This should be implemented as a control-plane
      command with confirmation policy, not as a private Pi-only shortcut.
- [ ] "Draft my prompt" flow: user writes intent in the Pi panel → Pi drafts →
      user approves → injected into PTY.
- [ ] Drift alerts: Pi raises a steering suggestion; one click sends it.
- [ ] Agent profiles: per-agent launch command + injection etiquette
      (Claude Code vs Codex vs Aider differ in how they accept mid-run input).
- [ ] Connected-agent cards: each workhorse agent can update its visible task,
      status, drift warnings, and "waiting for approval" state in the GUI.

### Phase D — Memory & the foreman (4–6 weeks)

Goal: Level 3.

- [ ] Vault journal: Pi writes/maintains `.wenmei/journal/` (markdown, of
      course); auto-briefing pasted into new workhorse sessions.
- [ ] Multi-terminal dashboard: status per PTY (active / idle / stuck
      heuristics), Pi/control plane as watcher across all of them.
- [ ] Night shift v1: task list file + supervised batch run + staged
      changesets + morning briefing. Explicitly no auto-commit.

### Phase E — Business layer (ongoing)

- [ ] Recipes/scheduled runs UI.
- [ ] Audit log export (compliance story).
- [ ] Licensing/packaging (see §5).

### Phase F — Production wiring & unified sidecar (added 07 Jul 2026)

Goal: fold the `app_design/` playground UX into the real app and make the
sidecar the single pane of glass. Two tracks run in parallel: an orchestrator
wires the backend (notifications, multi-session terminals, feed events) while
a spawned UX agent ports the playground surfaces (settings, bell) onto the
real frontend. Design doc: `docs/design/unified-sidecar.md`.

**Track 1 — Unified sidecar feed (the product spine).** One chronological
stream in the right panel replaces the Pi-chat-only view. Every event class
lands in the same scrollable feed, tagged and filterable by chips:

| Chip    | Contents                                                     | Source                              |
| ------- | ------------------------------------------------------------ | ----------------------------------- |
| All     | everything, interleaved                                      | —                                   |
| Chat    | user ↔ Pi work messages                                      | Pi RPC session                      |
| Narrate | narration digests, per terminal tab                          | `narration-digest` (+ `session_id`) |
| Alerts  | review changes, risky flags, terminal finished/stuck, system | new `wenmei-notification` event     |
| Review  | changeset approve/reject trail                               | `changeset-updated` + journal       |

Long scrolling: the feed hydrates from `journal.jsonl` (the journal _is_ the
persistence — no new store) and streams live events on top; older pages load
on scroll-up. Unread divider; header bell shows the unread Alerts count and
deep-links into the feed with the Alerts filter on.

**Track 2 — Terminal tabs ↔ narration.** Multi-session PTY backend
(`TerminalSession` map keyed by session id, per-tab `NarrationBuffer`,
events carry `session_id`), frontend tab strip from the playground, per-tab
Narrate toggle defaulting from Settings › Terminal (`narrate on` ships as
the default). Tab cap by memory setting or unlimited.

**Track 3 — Business layer: all settings real.** The playground
`SettingsPanel` (General / Terminal / Windows / Keyboard / Agent & Narration /
Integrations / License / About) ports to `src/` and every control persists —
UI prefs and keymap in the Zustand store, machine/vault-level settings
(narrate default, tab limit, sandbox-new-windows, narration depth, license
key) in Rust `AppState` → `state.json` through the bridge. No dead toggles:
a control that isn't wired doesn't ship.

- [x] F1 unified-sidecar design doc (event taxonomy, hydration, filters).
- [x] F2 notifications backend: journal kinds + `wenmei-notification` emits
      from review/nightshift/terminal-stuck/narration paths; OS notification
      (plugin already initialized) when the window is unfocused.
- [x] F3 multi-session terminal backend with per-session narration.
- [x] F4 terminal tab strip wired to real sessions; per-tab narrate.
- [x] F5 sidecar unified feed panel (filters, long scroll, journal hydrate).
- [x] F6 settings port + full persistence (UX agent + bridge wiring).
- [x] F7 header bell + settings gear in the real app (UX agent).
- [x] F8 multi-window: file → new Tauri window with its own sandbox scope.
- [x] F9 custom keymap persisted; shortcuts hook reads it.
- [x] F10 exit validation: checks green + a human run of tabs, feed, and
      every settings control round-tripping through restart.

#### F11–F14 — Sidecar surgery addendum (approved 08 Jul 2026)

The Q&A audit of the first F-pass found the real app's feed was cosmetic:
chips wired to nothing, no journal hydrate, no unread model, bell floating
over the header, settings a 34-line stub with read-only controls. The
playground (`app_design/`) now carries the approved UX — `SidecarFeed.tsx`
(chat as base layer + overlay items), `SidecarDetail.tsx` (click-to-expand
detail pane), `sidecar-types.ts` (item model + truncation helpers) — and the
surgery ports it **without changing the chat area behavior**. Three mechanics
carry over verbatim:

1. `inputActive` — typing in the composer collapses overlays to chat-only;
   blur/send restores.
2. Chips — Chat and All always render; Narrate/Alerts/Review collapse to
   unread notification dots in chat-only mode.
3. `filteredItems` — `inputActive || filter === "chat"` → chat only;
   `all` → interleaved by timestamp; otherwise filter-matched.

- [x] F11 feed surgery in PiPanel: port sidecar-types, assemble overlay items
      from the existing narration/notification/review listeners + journal
      hydrate on open, unread model (`lastSeenTs`, dots, divider), the three
      mechanics above. Chat pipeline untouched.
- [x] F12 detail pane: port SidecarDetail; overlay items click-to-expand
      (long content, diffs, artifacts, file refs via readFile); chat items
      deliberately don't.
- [x] F13 settings for real: port the full playground SettingsPanel; persist
      machine-level fields (`narrate_by_default`, `terminal_tab_limit`,
      `terminal_tabs_unlimited`, `sandbox_new_windows`, `narration_depth`)
      in AppState/state.json via bridge. Replace the read-only stub.
- [x] F14 bell into Header + deep-link (opens sidecar, Alerts filter, scrolls
      to unread divider); salvage the dead UX-agent worktree, then remove it.

**Phase F close note (08 Jul 2026):** F1-F14 are recorded done in the
playbook. `app_design/` remains the accepted ongoing visual playground; the
real app adapts the approved sidecar/settings/bell mechanics into production
components rather than deleting the playground.

### Phase G — v1.0 RC hardening (opened 08 Jul 2026)

Goal: turn the Phase F-complete app into a release candidate. This phase is
not a launch phase and not a new feature phase. It hardens the local-first
agent cockpit so a human can make a clear go/no-go decision for L4.

**Boundary:** stop before L4. No `1.0.0` version bump, no `v1.0` git tag, no
GitHub release publishing, and no announcement until River gives explicit
launch sign-off.

**What "RC" means here:**

- The dirty tree is intentional and explainable: accepted playground changes,
  real app Phase F ports, playbook records, and agent-facing memory/contract
  files are bucketed and ready for review.
- Known high-confidence bugs are fixed before subjective launch judgment:
  Finder/opened path formatting, stale control-plane discovery, and the
  background poller behavior that can trigger macOS permission prompts.
- The desktop app is validated as a product surface, not just compiled:
  root checks, playground checks, Rust checks, Tauri bundle build, and
  control-plane smoke all produce evidence.
- The launch decision is written as a go/no-go checklist, with remaining
  risks named plainly.

**RC tasks:**

- [ ] RC1 consolidate the dirty tree into intentional buckets and produce a
      v1.0 RC go/no-go checklist. Do not delete `app_design/`, `memory/`,
      `sessions/`, or `design-contract.yaml`; they are current project inputs.
- [ ] RC2 fix the known Finder/opened path formatting bug so vault-relative
      file-open paths use `/path`, not `/ path`.
- [ ] RC3 make `wenmeictl`/control discovery robust against stale repo-local
      `.wenmei/wenmei-control.json` shadowing the live app-support control file.
- [ ] RC4 reduce macOS permission-dialog risk from the background file poller
      by avoiding unnecessary full-tree walks when idle or when vaults live in
      protected locations.
- [ ] RC5 run release-candidate desktop validation: root checks, `app_design`
      checks, Rust check, Tauri app bundle build, control-plane smoke, and the
      written launch checklist.

### Phase H — Master control: ledger-bound Narrate + heartbeat (opened 11 Jul 2026)

Wenmei becomes the desktop master control for agentic workflow/loop
management. The strategic decision that anchors this phase: **Narrate binds
to the ledger, not the wire.**

**The model.** Three layers, one loop:

1. **Local observer** (Rust, zero tokens, zero leakage) — activity
   heuristics, changeset watcher, journal writer. Watches *any* agent in any
   terminal and records **facts**. Always on, free.
2. **The playbook ledger** (`.agents-playbook/` per project) — memory,
   backlog, journal, cycle brief, north star. The structured record of
   intent and progress. This is the integration surface for "managing many
   AI tools": any agent that speaks playbook gets supervision for free.
3. **Narrate** (Pi, invoked — never streaming) — reports playbook activity,
   runs secondary research/analysis, and monitors drift *grounded in the
   brief and north star it holds*. **Not optional and not a button**: it is
   the reporting layer of every managed project. Cost scales with task
   events, not terminal output; secrets never transit because the input is
   the ledger, not PTY bytes.

**Managed vs unmanaged gradient** (the adoption funnel): a folder without a
playbook gets observer facts only — alerts, changesets, timeline. "Manage
this project" scaffolds `.agents-playbook/` and turns on Narrate: briefings,
task-aware reports, drift watch, lesson write-back. Narrate may write to
`memory/lessons` and briefings; it never touches backlog status or
acceptance checks (the analyst reports on the ledger; it does not cook the
books).

**What dies:** the per-terminal Narrate toggle, PTY-stream narration as a
default path, the 10-second digest cadence, and the terminal auto-starting
Pi. Pi starts when the sidecar is engaged or a managed project needs it —
opening a terminal is just opening a terminal.

**Heartbeat** refits on top: a native tick engine (run cards with goal/wake
policy/stop condition persisted per project) that wakes runs, watches
stuck/idle via observer heuristics, and speaks only through
`emit_notification`. The `/loop` + agent-playbook pattern that built this
app, productized.

**UI-first workflow:** every Phase H surface is designed in `app_design/`
first, accepted, then ported (the F11–F14 pattern).

- [ ] H1 sentinel/ledger design doc: event-taxonomy union (playbook journal
      + wenmei journal), drift grounding on brief/north-star, write-back
      rules, managed/unmanaged gradient, per-project token budget.
- [ ] H2 playground UI: managed-project state in the sidecar (Managed ·
      `.agents-playbook` chip vs Watching-only), Narrate as reporting policy
      not toggle, Pi engage-on-demand status.
- [ ] H3 terminal decoupled from Pi: opening a terminal never auto-starts
      the Pi sidecar; per-tab narrate toggle removed (Narrate is a project
      property, not a terminal property).
- [ ] H4 vault management: +/− in the vault pulldown (add folder, soft-remove
      vault) and a Settings › Vaults section — multi-select, select-all,
      add/remove many. Removal is a soft detach from `state.json`; files are
      never touched.
- [ ] H5 multi-instance: multiple Wenmei windows from different folders
      (drop single-instance-per-machine; one window per vault/project, each
      with its own sandbox scope).
- [ ] H6 heartbeat engine: run cards, tick scheduler, stuck/idle wake,
      notifications integration.
- [ ] H7 resource + error production-grade pass: panic hook → journal +
      alert, frontend error boundary, disk/staging-cap alerts, per-session
      PTY memory caps.
- [ ] H8 in-app updater (tauri-plugin-updater) wired to release.yml
      artifacts, together with signing keys (one workflow).
- [ ] H9 alpha business closure: trial mechanics, payment provider
      selection, token add-on plan design for the later consumer tier.

---

## 5. Monetization sketch

- **Free:** local editor + one sandbox + manual agent sessions. Top of funnel;
  costs nothing (no backend, no inference — BYO agent + API key).
- **Pro** (~$8–15/mo or one-time ~$79): narration, diff review, run history,
  multiple vaults/composite workspaces, steering, scheduled recipes,
  cross-vault search. Solo professionals pay for _safety and repeatability_,
  not the editor.
- **Teams (later):** shared vault conventions + audit log export. "We can show
  what AI touched" is a procurement checkbox in legal/consulting/finance.

Local-first is the feature, not the limitation: _"your files never leave your
machine; bring your own agent"_ — and Wenmei never carries inference costs.

---

## 6. Risks & open questions

- **Narration quality/cost:** streaming PTY output through Pi burns tokens.
  Mitigate: chunking, summarize-on-idle, user-selectable narration depth.
- **PTY output parsing:** ANSI noise, TUI redraws (Claude Code's own UI) make
  raw output messy. May need per-agent output filters in agent profiles.
- **Injection etiquette:** typing into a running agent mid-turn can confuse
  it. Agent profiles must encode when it's safe to inject.
- **Staging performance:** copy-on-write baselines for large vaults need care;
  consider hashing + lazy copy.
- **Control-plane security:** a local bridge is powerful. It must be
  local-only, token-gated, auditable, and policy-aware. Destructive actions and
  PTY injection need confirmation or explicit standing approval.
- **Protocol sprawl:** CLI, MCP, Pi RPC, and GUI events can drift apart. Keep
  one internal command/event schema and make every surface a client of it.
- **`main.rs` monolith (~2300 lines):** Phases B–D add real surface area;
  budget a module split before Phase C.
- **Pi dependency:** sidecar currently requires a global `pi` binary. Decide
  whether the sidecar role itself becomes pluggable (any RPC-speaking agent)
  or Pi-bundled-as-sidecar ships eventually.

---

## 7. One-liners (for the landing page)

- "Every powerful agent is a terminal. Wenmei gives it a manager."
- "Point an AI agent at a folder of your real files. Watch what it does.
  Approve or roll back every change."
- "The safe desktop where AI agents do real work on your files — visible,
  reviewable, reversible."
