---
phase: 8
started: "2026-07-08T12:50:38.035Z"
goal: "Phase G: v1.0 RC hardening — turn the Phase F-complete app into a release candidate by cleaning agent-facing state, fixing known high-confidence bugs, validating desktop install/runtime behavior, and producing a clear go/no-go launch checklist."
stop: "Stop before L4 release actions: no v1.0.0 version bump, no v1.0 tag, no GitHub release publishing, and no announcement until River gives explicit launch sign-off."
---

# Cycle Brief — phase 8

> Confirm this at the START of each phase, before claiming work. The North Star does
> not change; this cycle's goal does. Fill all five, then `node scripts/pb.mjs status`.

## 1. What is this cycle's goal?

Phase G: v1.0 RC hardening — turn the Phase F-complete app into a release candidate by cleaning agent-facing state, fixing known high-confidence bugs, validating desktop install/runtime behavior, and producing a clear go/no-go launch checklist.

## 2. What challenges do I foresee?

The biggest risk is confusing release-candidate hardening with launch. L4 must
remain blocked until explicit human sign-off, so this phase should produce
evidence and fixes, not publish anything. The tree is intentionally dirty in
several categories: accepted `app_design/` playground work, real app Phase F
ports, playbook state, and agent-facing `memory/`, `sessions/`, and
`design-contract.yaml`. Treat them as material to consolidate and commit
deliberately, not as accidental trash. Known technical risks are the Finder
file-open path bug, stale `.wenmei/wenmei-control.json` shadowing the live
app-support control file, the full-WalkDir poller causing macOS permission
dialogs, and release-signing/notarization uncertainty.

## 3. What were the previous challenges?

Phase F closed after F1-F14: the real app now has unified sidecar overlays,
alert bell deep-linking, full settings persistence, terminal tab scaffolding,
and the accepted playground direction captured in `design-contract.yaml`.
The close checks passed, including root lint/check/test, app_design check/build,
Rust cargo check, Tauri app bundle build, and installed desktop ACP status.
Carry-over: `app_design/` remains the accepted visual playground; it should not
be deleted as cleanup. The roadmap now names this RC work as Phase G. L4 is
still blocked pending explicit launch sign-off.

## 4. Where do I stop / hand back?

Stop before L4 release actions: no v1.0.0 version bump, no v1.0 tag, no GitHub release publishing, and no announcement until River gives explicit launch sign-off.

## 5. Conflicts with my own (agent) memory?

Host memory or earlier session notes may imply the playground is temporary
handoff code or that F11-F14 still need porting. Folder state wins: River has
accepted `app_design/` visually, Phase F is closed, and the next work is RC
hardening with no publishing. The agent should not silently clean up
`app_design/`, `memory/`, `sessions/`, or `design-contract.yaml`.
