// ─── Narration harness (Settings › Terminal › Narration) ────────────────────
// The instruction prompt the sidecar agent receives before each narration
// digest. The digest itself (terminal output, file changes, drift flags) is
// appended programmatically in PiPanel's narration-digest listener — the
// harness only steers *what the agent should pay attention to and narrate*.

export const DEFAULT_NARRATION_PROMPT =
  "You are observing a terminal session. Summarize what the agent just did in 1-3 sentences. Flag anything risky, including possible task drift.";

/** The prompt narration actually runs with — the user's custom harness, or
 *  the built-in default when unset (empty/whitespace). */
export function effectiveNarrationPrompt(custom: string): string {
  const trimmed = custom.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_NARRATION_PROMPT;
}
