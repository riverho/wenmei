import { Bell, Bot, GitCompare, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  AlertSeverity,
  SidecarItem,
  SidecarItemKind,
} from "@/lib/sidecar-types";

// ─── Helpers for the unified sidecar feed (docs/design/unified-sidecar.md).
// Components live in components/SidecarOverlay.tsx; this module keeps the
// non-component exports so react-refresh stays happy.

export type FeedFilter = "all" | "chat" | "narrate" | "alerts" | "review";

export const FILTER_CONFIG: {
  key: Exclude<FeedFilter, "chat">;
  label: string;
  icon: LucideIcon;
  color: string;
}[] = [
  { key: "all", label: "All", icon: Sparkles, color: "var(--text-secondary)" },
  { key: "narrate", label: "Narrate", icon: Bot, color: "#a78bfa" },
  { key: "alerts", label: "Alerts", icon: Bell, color: "#fb923c" },
  { key: "review", label: "Review", icon: GitCompare, color: "#fbbf24" },
];

export function relTime(ts: string): string {
  const then = Date.parse(ts);
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function kindToFilter(kind: SidecarItemKind): FeedFilter {
  if (kind === "narrate") return "narrate";
  if (kind === "alert") return "alerts";
  if (kind === "review_change" || kind === "review_decision") return "review";
  return "chat";
}

/** Map a journal event (kind/summary/ts) onto an overlay item. */
export function journalEventToItem(event: {
  ts: string;
  kind: string;
  summary: string;
  metadata?: unknown;
}): SidecarItem | null {
  const meta = (event.metadata ?? {}) as { session_id?: string | null };
  const base = {
    id: `jrnl-${event.ts}-${event.kind}`,
    ts: event.ts,
    tsLabel: relTime(event.ts),
    body: event.summary,
    summary: event.summary,
    sessionId: meta.session_id ?? undefined,
    artifacts: [],
    read: false,
    expanded: false,
    inOverlay: false,
  };
  if (event.kind === "narration.digest") {
    return { ...base, kind: "narrate", label: "Narration" };
  }
  if (event.kind.startsWith("notification.")) {
    const alertKind = event.kind.slice("notification.".length);
    const severity: AlertSeverity =
      alertKind.includes("risky") || alertKind.includes("stuck")
        ? "warning"
        : alertKind.includes("done")
          ? "success"
          : "info";
    return {
      ...base,
      kind: "alert",
      label: "Alert",
      severity,
      alertLabel: alertKind,
    };
  }
  if (event.kind.startsWith("review.")) {
    const decision =
      event.kind === "review.approved" || event.kind === "review.rejected";
    return {
      ...base,
      kind: decision ? "review_decision" : "review_change",
      label: "Review",
    };
  }
  return null;
}
