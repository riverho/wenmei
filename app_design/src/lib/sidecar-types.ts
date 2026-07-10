// ─── Unified Sidecar Feed — Data Types ───

export type SidecarFilter = "all" | "chat" | "narrate" | "alerts" | "review";

export type SidecarItemKind =
  | "chat"
  | "narrate"
  | "alert"
  | "review_change"
  | "review_decision"
  | "terminal_stdio"
  | "system";

export type AlertSeverity = "info" | "warning" | "error" | "success";

export interface SidecarArtifact {
  /** Display label shown on the badge */
  label: string;
  /** 'code' | 'diff' | 'file' | 'table' | 'link' | 'image' | 'chart' */
  type: "code" | "diff" | "file" | "table" | "link" | "image" | "chart";
  /** Raw content (markdown for code/diff/table, URL for link/image, etc.) */
  content: string;
  /** Language tag for code blocks */
  language?: string;
  /** Optional: a highlighted snippet for collapsed preview */
  preview?: string;
}

export interface SidecarToolUse {
  name: string;
  status: "started" | "done" | "error";
  duration_ms?: number;
}

export interface SidecarDiffLine {
  type: "old" | "new" | "context";
  text: string;
}

export interface SidecarItem {
  id: string;
  kind: SidecarItemKind;
  /** Visible label for the kind chip */
  label: string;
  /** When this item appeared */
  ts: string;
  /** Relative time string shown in UI */
  tsLabel: string;
  /** Human-readable one-liner summary (used in collapsed state) */
  summary: string;
  /** Full message body. May contain newlines, code, etc. */
  body: string;
  /** Role — only present for chat messages */
  role?: "user" | "assistant" | "system";
  /** Session id this item belongs to (terminal session, review session, etc.) */
  sessionId?: string;
  /** Terminal session title shown in the header */
  sessionTitle?: string;
  /** Review session title */
  reviewSessionId?: string;
  /** Alert severity (only for kind === 'alert') */
  severity?: AlertSeverity;
  /** Alert body prefix label (only for kind === 'alert') */
  alertLabel?: string;
  /** Long-form content to show in the detail overlay (defaults to body if absent) */
  detail?: string;
  /** Code blocks, diffs, file refs, links extracted from body */
  artifacts: SidecarArtifact[];
  /** Tool calls made during this assistant turn */
  toolUses?: SidecarToolUse[];
  /** Thinking chain events */
  thinkingChain?: string[];
  /** @file references extracted from body */
  fileRefs?: string[];
  /** Lines for diff-type artifacts */
  diffLines?: SidecarDiffLine[];
  /** Read/unread state */
  read: boolean;
  /** Expanded in the feed (shows full body inline) */
  expanded: boolean;
  /** Expanded in the detail overlay */
  inOverlay: boolean;
}

// ─── Truncation constants ───
export const TRUNCATE_CHARS = 280;
export const TRUNCATE_LINES = 5;
export const MAX_TOOL_USE_PREVIEW = 3;
export const MAX_THINKING_PREVIEW = 2;

// ─── Helpers ───

export function isLongContent(text: string): boolean {
  if (text.length > TRUNCATE_CHARS) return true;
  const lines = text.split("\n");
  if (lines.length > TRUNCATE_LINES) return true;
  return false;
}

export function truncateBody(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= TRUNCATE_LINES && text.length <= TRUNCATE_CHARS) {
    return text;
  }
  // Truncate to first TRUNCATE_LINES lines, then clamp chars
  const truncated = lines.slice(0, TRUNCATE_LINES).join("\n");
  if (truncated.length <= TRUNCATE_CHARS) return truncated;
  return truncated.slice(0, TRUNCATE_CHARS - 1) + "…";
}

export function buildSummary(item: SidecarItem): string {
  if (item.summary) return item.summary;
  if (item.kind === "alert") {
    return `[${item.alertLabel ?? item.severity ?? "alert"}] ${item.body.split("\n")[0]}`;
  }
  if (item.kind === "review_change") {
    const first = item.body.split("\n")[0];
    return first.length > 80 ? first.slice(0, 80) + "…" : first;
  }
  if (item.kind === "review_decision") {
    return item.body;
  }
  const firstLine = item.body.split("\n")[0];
  return firstLine.length > 120 ? firstLine.slice(0, 120) + "…" : firstLine;
}

export function extractFileRefs(text: string): string[] {
  const refs: string[] = [];
  const regex = /@([^\s:]+(?:\/[^\s:]+)*)(?::(\d+))?/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    refs.push(match[1]);
  }
  return [...new Set(refs)];
}

export function extractArtifacts(text: string): SidecarArtifact[] {
  const artifacts: SidecarArtifact[] = [];

  // ```code blocks
  const codeBlocks = text.matchAll(/```(\w*)\n([\s\S]*?)```/g);
  for (const match of codeBlocks) {
    artifacts.push({
      label: match[1] || "code",
      type: "code",
      language: match[1] || "text",
      content: match[2].trim(),
      preview: match[2].split("\n").slice(0, 3).join("\n"),
    });
  }

  // Diff lines (lines starting with +/-/space)
  const diffLines: SidecarDiffLine[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("+") || line.startsWith("-")) {
      diffLines.push({
        type: line.startsWith("+") ? "new" : "old",
        text: line.slice(1),
      });
    }
  }
  if (diffLines.length > 0) {
    artifacts.push({
      label: "diff",
      type: "diff",
      content: text,
      preview: diffLines
        .slice(0, 4)
        .map(l => `${l.type === "new" ? "+" : "-"}${l.text}`)
        .join("\n"),
    });
  }

  // URLs
  const urls = text.matchAll(/(https?:\/\/[^\s]+)/g);
  for (const match of urls) {
    artifacts.push({
      label: "link",
      type: "link",
      content: match[1],
      preview: match[1],
    });
  }

  return artifacts;
}
