# Design Note — The Quiet Sidecar

**Status:** Product direction, 13 Jul 2026  
**Refines:** [Unified Sidecar Feed](./unified-sidecar.md) and
[Sentinel, Ledger, and the Orchestrator](./sentinel-ledger.md)

## Mental-model change

**Before:** a single pane of glass where the human watches the sidecar watch
the agent.

**After:** a quiet awareness layer that watches continuously so the human does
not have to.

The feed remains the evidence trail, not the primary experience. Wenmei should
become visible only when there is a decision, deviation, contradiction, risk,
or meaningful completion.

> Product test: does this save the user from monitoring the agent, or give them
> another window to monitor?

## Less-is-more rules

1. **Silence is the healthy state.** Routine progress creates history, not
   interruptions.
2. **Exceptions first.** Collapse safe work; expand only what needs judgment.
3. **One interruption, one decision.** Every alert includes evidence, a clear
   question, and reversible actions.
4. **Facts before narration.** Show what changed and why it matters. Generate
   analysis only when facts are ambiguous.
5. **Remember reasons, not transcripts.** Durable memory stores decisions,
   rejected approaches, scope, and outcomes.
6. **Resume intention, not windows.** On return, restore the unresolved decision
   and what changed since it was deferred.
7. **Restraint is intelligence.** A sidecar that speaks constantly has failed to
   filter.

## Product improvement

Replace feed-first supervision with three lightweight states:

- **Quiet:** no card, or one ambient line such as “Working · within scope.”
- **Attention:** one foreground decision card; related events are grouped
  behind it.
- **Return:** a short briefing of outcomes, exceptions, and the next decision.

The chronological feed remains available for audit and drill-down. It should
not create unread anxiety. OS notifications are reserved for blocked, burning,
or completed work that has a useful next action.

Narration should move from periodic commentary to milestone summaries:

- intent changed;
- scope crossed;
- the same approach is looping;
- evidence contradicts “done”;
- human input is required;
- a meaningful unit of work completed.

## Surprising moments

### Scope guardian

“The task was documentation-only, but two build files changed. Accept the docs
and hold the rest?”

### Loop detector

“Three implementation attempts produced the same failure. Pause and diagnose a
different layer?”

### Return briefing

“While you were away: 14 notes reorganized, 23 links repaired, one source
contradicts the summary. Review the contradiction?”

### Decision memory

“You rejected this structure before because it fragmented casual notes. Keep
that preference or reconsider it?”

### Evidence check

“The agent says the task is complete, but the affected tests were not run and
one document still describes the old behavior. Verify before accepting?”

## Success criteria

- The user can leave a healthy run without watching the feed.
- Most recorded events never become notifications.
- Alerts have a high action rate and a low false-alarm rate.
- Returning users understand the run and reach the next decision in under a
  minute.
- Review begins with exceptions; safe changes can be accepted as a batch.
- Wenmei reduces context reconstruction, terminal archaeology, and approval
  fatigue.

The desired feeling is not “an AI is talking beside me.” It is:

> Something competent kept watch, stayed quiet, and called me only when my
> judgment mattered.
