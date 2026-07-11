# Wenmei Landing Page Content Update Proposal

## Goal

Refresh `landing/index.html` so it speaks to the current Wenmei product: **a sidecar control room for AI agents working on your local files**. The page should not position Wenmei as a better terminal, a better editor, or another AI chat app. It should make advanced agent users immediately understand the missing layer Wenmei provides, while still giving non-technical readers a plain-language translation: Wenmei watches agent work, surfaces important signals, and turns them into actions.

---

## What is out of date today

1. **Version badge** still says `v0.1.0`; the live product is `v0.2.1`.
2. **Hero framing** leads with "terminal" and "manager" — accurate, but it still sounds like terminal tooling. It should land the stronger category: _a sidecar control room for AI agents_.
3. **Value props are split between audiences without naming the overlap**: advanced users already have VS Code, Cursor, Ghostty, Warp, Claude Code, Codex, Aider, etc.; end users need a simpler promise. The overlap is not "editor" or "terminal" — it is _supervision for agent work_.
4. **"How it works"** describes three surfaces but misses the signal/action loop: Wenmei observes agent output and file changes, surfaces what matters, and gives actions like review, reject, steer, resume, or roll back.
5. **No clear value proposition hierarchy**: local-first, visibility, and control are all present but scattered.
6. **Social proof / use cases** are absent. The page does not help a visitor picture themselves using it.

---

## Recommended positioning

### Category

> **A sidecar control room for AI agents.**

### One-line promise

> **Keep your tools. Add a sidecar for agent work.**

### Supporting idea

Wenmei is not another terminal, editor, or chatbot. It sits beside the tools people already use — VS Code, Cursor, Ghostty, Warp, Claude Code, Codex, Aider, and local markdown/project folders. It watches agent work, surfaces important signals, and turns those signals into actions: review, approve, reject, steer, summarize, resume, or roll back. Your files stay local and plain.

### Audience priority

Lead with advanced agent users first. They already feel the pain: terminal scrollback, scattered diffs, lost run context, hard-to-review agent edits, and no shared control surface across agents. Then translate the same promise for end users as "AI help on your files without losing control."

Do **not** ask visitors to replace their editor or terminal. The message is additive:

> You already have an editor, a terminal, and an agent. Wenmei is the sidecar that makes agent work observable, reviewable, and actionable.

---

## Proposed value propositions

Use these as the headline benefits across the page. They are ordered from the clearest category wedge to the strongest trust proof.

### 1. Keep your workflow

Wenmei does not replace VS Code, Cursor, Ghostty, Warp, Claude Code, Codex, or Aider. It sits beside them as the sidecar for agent work. Keep the tools you already use; add supervision.

### 2. Turn agent noise into signals

Agent runs produce terminal output, file changes, review comments, risky moments, and half-remembered context. Wenmei pulls out what matters so you do not have to reconstruct a run from scrollback.

### 3. Turn signals into actions

Important moments should become decisions: review this diff, reject that file, steer the run, summarize what happened, resume tomorrow, or roll back. Wenmei is not just a log viewer; it is an action surface.

### 4. Reviewable local work

Every edit lands as a reviewable changeset. Approve what helps, reject what does not, roll back the rest. Agent output is treated like a draft, not a deployment.

### 5. Local files, plain format, scoped rules

Wenmei works directly on local markdown folders. No import, no proprietary workspace, no cloud account. Paths stay inside the vault, deleted files move to trash, and meaningful actions are journaled.

---

## Recommended section structure

### Hero

**Headline option A (direct):**

> Keep your tools. Add a sidecar for agent work.

**Headline option B (category-defining):**

> A sidecar control room for AI agents.

**Headline option C (advanced-user wedge):**

> Stop reading terminal scrollback. Manage agent work as signals and actions.

**Subheadline:**

> Wenmei sits beside your editor, terminal, and AI agents. It watches local file work, surfaces the important signals, and gives you actions: review, approve, reject, steer, summarize, resume, or roll back.

**CTAs:**

- Primary: "Download for macOS"
- Secondary: "See the sidecar loop" (anchor to how-it-works)

Keep a softer "View on GitHub" link in the nav/footer. The hero should sell the sidecar loop, not split visitors into download-vs-code immediately.

### Trust bar (new, optional)

A single row below the hero to set expectations without boasting:

> Works beside your tools · Local-first · Plain markdown · Reviewable changes · MIT open source

### Screencast / screenshots

Keep the screenshot grid, but lead with a clearer caption:

> Signals from your agent run — terminal, files, review, and journal — in one sidecar.

Consider adding short labels to each screenshot if the current five images correspond to specific modes (edit, terminal, agent overlay, review, paper mode).

### Value props section

Replace the current three-card grid with the five value props above, using two rows:

- Row 1: "Keep your workflow" / "Turn agent noise into signals" / "Turn signals into actions"
- Row 2: "Reviewable local work" / "Local files, scoped rules"

Use calm signal/action icons rather than literal terminal chrome everywhere. The page can acknowledge terminals, but it should not visually read as a terminal replacement.

### How it works

Keep the three-step structure, but reframe around the _signal/action loop_, not just surfaces:

1. **Keep working where you work.** Use your editor, terminal, and agent setup. Point Wenmei at the local folder that matters.
2. **Let the sidecar watch.** Wenmei observes terminal output, file changes, review events, and journal entries. It filters the run into important signals.
3. **Act on what matters.** Review a changeset, reject a risky edit, steer the agent, summarize the run, resume later, or roll back.

### Use-case moments (new section)

Split scenarios into one advanced-user row and one broader row.

Advanced-user row:

- **For agent power users:** Run Claude Code, Codex, Aider, or your own terminal agent. Wenmei turns messy runs into reviewable signals and actions.
- **For developers:** Keep VS Code, Cursor, Ghostty, Warp, or your terminal stack. Wenmei adds run supervision, changeset review, and local memory.
- **For technical operators:** Let agents update project folders, docs, specs, and scripts while Wenmei records what changed and what needs a decision.

Broader row:

- **For researchers:** Collect papers, notes, and drafts in one folder. Ask the agent to synthesize, compare, or restructure. You keep the sources.
- **For writers:** Draft in markdown, let the agent suggest edits or rewrites, and accept only the changes that match your voice.
- **For teams later:** Use the journal and review trail to answer what AI touched, what was accepted, and what was rolled back.

### Open source / trust section

Keep the Tauri/Rust/React line, but move the technical stack lower on the page. Lead with the trust/control-plane benefit:

> Built as a sidecar, not a black box.
>
> Local files stay local. Agent work is scoped, journaled, and reviewable. Wenmei is open source under MIT, so advanced users can inspect the control plane instead of trusting a cloud workspace.

### Download

Update the version badge to `v0.2.1` and refresh the copy:

> Try it on a folder of markdown files.
>
> No setup, no sign-up, no cloud.

Keep the platform buttons (macOS Apple Silicon, macOS Intel, Linux).

### Footer

Simplify:

> Wenmei — a sidecar control room for AI agents working on local files.

---

## Tone guidelines

- **Calm, not hype.** Avoid "supercharge," "revolutionize," "AI-powered."
- **Concrete, not abstract.** Talk about folders, files, approval, and rollback — not "workflows" or "productivity."
- **Advanced first, still legible.** Use names like Claude Code, Codex, Aider, VS Code, Cursor, Ghostty, and Warp where they prove "works beside your tools." In broader sections, translate back to "your agent," "your editor," and "your files."
- **Honest about scope.** Wenmei is for local markdown vaults. Do not imply it is a generic IDE or a chat app.

---

## Specific copy to retire

| Current                                                                         | Why retire                                                                                              | Replace with                                                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| "Every powerful agent is a terminal. Wenmei gives it a manager."                | Too terminal-centric; invites comparison with Warp/Ghostty/iTerm instead of defining the missing layer. | "Keep your tools. Add a sidecar for agent work."                                                |
| "Point an AI agent at a folder of your real files."                             | Good, but too end-user generic and not differentiated for advanced users.                               | "Wenmei watches agents working in your local folders and turns important signals into actions." |
| "Run Claude Code, Codex, Aider — any CLI agent"                                 | Useful for technical proof, but too narrow for the hero.                                                | "Works beside the agents and tools you already use."                                            |
| "The safe desktop where agents do real work — visible, reviewable, reversible." | Still true, but less sharp than the sidecar category.                                                   | Use as supporting copy below the hero.                                                          |

---

## Recommended meta description update

> Wenmei is a local sidecar control room for AI agents working on your files. Keep your existing editor, terminal, and agents while Wenmei surfaces important signals, stages reviewable changes, and gives you actions to approve, reject, steer, resume, or roll back.

---

## Open questions for you

1. **Audience priority:** The recommended wedge is advanced agent users first, broader end users second. Confirm that the page should lead with the sidecar/control-room category rather than a softer "safe desktop" framing.
2. **Screenshots:** Do the five existing `wenmei_screenshot*.png` images map to specific modes? Labeling them would make the screencast section stronger.
3. **Call to action:** Is the primary goal downloads, GitHub stars, or newsletter/waitlist? The current page optimizes for download; confirm this is still right.
4. **Social proof:** Do we have any early user quotes, case studies, or metrics to add? Even one quote would strengthen the value-prop section.

---

## Suggested next step

Review this proposal. Once the direction is approved, the next task is to rewrite `landing/index.html` section by section around the sidecar/control-room category, update the version badge and meta tags, and add the signal/action loop to the hero and how-it-works sections.
