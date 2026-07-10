import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type KeyboardEvent,
} from "react";
import { useAppStore } from "@/store/appStore";
import {
  buildSummary,
  isLongContent,
  truncateBody,
  type SidecarArtifact,
  type SidecarFilter,
  type SidecarItem,
  type SidecarItemKind,
} from "@/lib/sidecar-types";
import {
  Terminal,
  MessageSquare,
  Bell,
  GitCompare,
  ChevronDown,
  ChevronUp,
  Maximize2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Loader2,
  FileText,
  ArrowRight,
  Bot,
  Sparkles,
  RefreshCw,
  Paperclip,
  Send,
  type LucideIcon,
} from "lucide-react";
import SidecarDetail from "./SidecarDetail";

// ─── Seed data for the playground ──────────────────────────────────────────────

const SEED_ITEMS: SidecarItem[] = [
  {
    id: "seed-1",
    kind: "alert",
    label: "Alert",
    ts: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    tsLabel: "2m ago",
    summary: "Risky change flagged",
    body: "The agent edited a date calculation you didn't ask about. It modified `src/billing.ts` to use a different leap-year algorithm. Verify this is intentional.",
    alertLabel: "Risky change",
    severity: "warning",
    artifacts: [
      {
        label: "diff",
        type: "diff",
        content:
          "- const days = year % 4 === 0 ? 366 : 365;\n+ const days = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;",
        preview: "+ const days = (year % 4 === 0…",
      },
    ],
    fileRefs: ["src/billing.ts"],
    read: false,
    expanded: false,
    inOverlay: false,
  },
  {
    id: "seed-2",
    kind: "review_change",
    label: "Review",
    ts: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    tsLabel: "4m ago",
    summary: "3 files changed — awaiting review",
    body: "Modified: src/billing.ts (12kb), notes/2026-q3.md (2kb)\nAdded: reports/summary.csv (4kb)\n\nReview session: rs-2026-07-07-001",
    reviewSessionId: "rs-2026-07-07-001",
    artifacts: [
      {
        label: "src/billing.ts",
        type: "file",
        content: "src/billing.ts",
        preview: "modified · 12kb",
      },
      {
        label: "notes/2026-q3.md",
        type: "file",
        content: "notes/2026-q3.md",
        preview: "modified · 2kb",
      },
      {
        label: "reports/summary.csv",
        type: "file",
        content: "reports/summary.csv",
        preview: "added · 4kb",
      },
    ],
    read: false,
    expanded: false,
    inOverlay: false,
  },
  {
    id: "seed-3",
    kind: "narrate",
    label: "Narration",
    ts: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    tsLabel: "5m ago",
    summary: "Ran test suite, all green",
    body: "The agent ran the full test suite across 47 tests. All tests pass. It then refactored the date helper into a shared util module and updated the two call sites in billing.ts and scheduler.ts.",
    sessionTitle: "zsh 1",
    sessionId: "term-1",
    toolUses: [
      { name: "shell: npm test", status: "done", duration_ms: 8200 },
      { name: "write: src/utils/date.ts", status: "done", duration_ms: 340 },
      { name: "read: src/billing.ts", status: "done", duration_ms: 45 },
    ],
    artifacts: [
      {
        label: "bash",
        type: "code",
        language: "bash",
        content: "npm test\n\n✓ 47 tests passed\n  duration: 8.2s",
        preview: "npm test\n\n✓ 47 tests passed",
      },
    ],
    read: true,
    expanded: false,
    inOverlay: false,
  },
  {
    id: "seed-4",
    kind: "chat",
    label: "Chat",
    ts: new Date(Date.now() - 7 * 60 * 1000).toISOString(),
    tsLabel: "7m ago",
    summary: "Explain the billing module",
    body: `Here's an overview of the billing module:

The module handles recurring invoice generation and payment tracking. Key entities:

\`\`\`typescript
interface Invoice {
  id: string;
  clientId: string;
  amount: number;
  currency: 'USD' | 'EUR' | 'GBP';
  dueDate: Date;
  status: 'draft' | 'sent' | 'paid' | 'overdue';
}
\`\`\`

It integrates with Stripe for payment processing and maintains a local ledger for audit purposes.`,
    role: "assistant",
    artifacts: [
      {
        label: "typescript",
        type: "code",
        language: "typescript",
        content: `interface Invoice {
  id: string;
  clientId: string;
  amount: number;
  currency: 'USD' | 'EUR' | 'GBP';
  dueDate: Date;
  status: 'draft' | 'sent' | 'paid' | 'overdue';
}`,
        preview: "interface Invoice {…",
      },
    ],
    fileRefs: [],
    read: true,
    expanded: false,
    inOverlay: false,
  },
  {
    id: "seed-5",
    kind: "chat",
    label: "Chat",
    ts: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    tsLabel: "8m ago",
    summary: "What's in the billing module?",
    body: "What's in the billing module? Can you give me a quick overview?",
    role: "user",
    artifacts: [],
    read: true,
    expanded: false,
    inOverlay: false,
  },
  {
    id: "seed-6",
    kind: "terminal_stdio",
    label: "Terminal",
    ts: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    tsLabel: "10m ago",
    summary: "git status — clean",
    body: `$ git status
On branch main
Your branch is up to date with 'origin/main'.
nothing to commit, working tree clean`,
    sessionTitle: "zsh 1",
    sessionId: "term-1",
    artifacts: [],
    read: true,
    expanded: false,
    inOverlay: false,
  },
  {
    id: "seed-7",
    kind: "review_decision",
    label: "Review",
    ts: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    tsLabel: "15m ago",
    summary: "Approved docs/changelog.md",
    body: "Approved: docs/changelog.md — changes are intentional (added v0.2.1 release notes). Baseline restored for comparison.",
    reviewSessionId: "rs-2026-07-07-prev",
    artifacts: [
      {
        label: "docs/changelog.md",
        type: "file",
        content: "docs/changelog.md",
        preview: "approved",
      },
    ],
    read: true,
    expanded: false,
    inOverlay: false,
  },
  {
    id: "seed-8",
    kind: "narrate",
    label: "Narration",
    ts: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
    tsLabel: "18m ago",
    summary: "Drafted release notes for v0.2.1",
    body: "Pi drafted release notes for v0.2.1 based on the git log. The release notes cover the new diff-review feature, bug fixes for the sandbox path resolver, and updated CLI documentation. No risky edits detected.",
    sessionTitle: "zsh 2",
    sessionId: "term-2",
    toolUses: [
      { name: "read: CHANGELOG.md", status: "done", duration_ms: 120 },
      { name: "write: docs/changelog.md", status: "done", duration_ms: 280 },
    ],
    artifacts: [],
    read: true,
    expanded: false,
    inOverlay: false,
  },
  {
    id: "seed-9",
    kind: "system",
    label: "System",
    ts: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    tsLabel: "20m ago",
    summary: "Review session started",
    body: "Review session rs-2026-07-07-001 started. Baseline snapshot taken for 23 files across 3 folders.",
    artifacts: [],
    read: true,
    expanded: false,
    inOverlay: false,
  },
  {
    id: "seed-10",
    kind: "alert",
    label: "Alert",
    ts: new Date(Date.now() - 22 * 60 * 1000).toISOString(),
    tsLabel: "22m ago",
    summary: "Terminal 2 finished",
    body: "Terminal session zsh 2 (PID 48921) exited cleanly after completing the release note draft. Duration: 4m 12s. No errors.",
    severity: "success",
    alertLabel: "Done",
    sessionTitle: "zsh 2",
    sessionId: "term-2",
    artifacts: [],
    read: true,
    expanded: false,
    inOverlay: false,
  },
];

// ─── Filter chip config ────────────────────────────────────────────────────────

const FILTER_CONFIG: {
  key: SidecarFilter;
  label: string;
  icon: LucideIcon;
  color: string;
}[] = [
  { key: "all", label: "All", icon: Sparkles, color: "var(--text-secondary)" },
  { key: "narrate", label: "Narrate", icon: Bot, color: "#a78bfa" },
  { key: "alerts", label: "Alerts", icon: Bell, color: "#fb923c" },
  { key: "review", label: "Review", icon: GitCompare, color: "#fbbf24" },
];

// ─── Severity config ──────────────────────────────────────────────────────────

function SeverityIcon({ severity }: { severity: string }) {
  switch (severity) {
    case "error":
      return <XCircle size={13} style={{ color: "var(--accent-rose)" }} />;
    case "warning":
      return <AlertTriangle size={13} style={{ color: "#f59e0b" }} />;
    case "success":
      return <CheckCircle2 size={13} style={{ color: "var(--accent-teal)" }} />;
    default:
      return <Info size={13} style={{ color: "var(--text-tertiary)" }} />;
  }
}

function KindBadge({ kind, label }: { kind: SidecarItemKind; label: string }) {
  const colors: Record<SidecarItemKind, { bg: string; text: string }> = {
    chat: { bg: "rgba(0, 134, 115, 0.1)", text: "var(--accent-teal)" },
    narrate: { bg: "rgba(167, 139, 250, 0.1)", text: "#a78bfa" },
    alert: { bg: "rgba(251, 146, 60, 0.1)", text: "#fb923c" },
    review_change: { bg: "rgba(251, 191, 36, 0.1)", text: "#fbbf24" },
    review_decision: { bg: "rgba(251, 191, 36, 0.1)", text: "#fbbf24" },
    terminal_stdio: {
      bg: "rgba(100, 116, 139, 0.1)",
      text: "var(--text-tertiary)",
    },
    system: { bg: "rgba(100, 116, 139, 0.1)", text: "var(--text-tertiary)" },
  };
  const c = colors[kind] ?? {
    bg: "var(--surface-2)",
    text: "var(--text-tertiary)",
  };
  return (
    <span
      className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ background: c.bg, color: c.text }}
    >
      {label}
    </span>
  );
}

// ─── Tool use badge ───────────────────────────────────────────────────────────

function ToolUseBadge({
  tool,
}: {
  tool: { name: string; status: string; duration_ms?: number };
}) {
  const done = tool.status === "done";
  const err = tool.status === "error";
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
      style={{
        background: err
          ? "rgba(194, 74, 74, 0.1)"
          : done
            ? "rgba(0, 134, 115, 0.08)"
            : "rgba(100, 116, 139, 0.1)",
        color: err
          ? "var(--accent-rose)"
          : done
            ? "var(--accent-teal)"
            : "var(--text-tertiary)",
      }}
    >
      {tool.status === "started" ? (
        <Loader2 size={9} className="animate-spin" />
      ) : done ? (
        <CheckCircle2 size={9} />
      ) : (
        <XCircle size={9} />
      )}
      {tool.name}
      {tool.duration_ms && (
        <span style={{ opacity: 0.6 }}>
          {tool.duration_ms > 1000
            ? `${(tool.duration_ms / 1000).toFixed(1)}s`
            : `${tool.duration_ms}ms`}
        </span>
      )}
    </span>
  );
}

// ─── Artifact chip ─────────────────────────────────────────────────────────────

function ArtifactChip({ artifact }: { artifact: SidecarArtifact }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded cursor-pointer hover:opacity-80 transition-opacity"
      style={{
        background: "var(--surface-2)",
        color: "var(--text-secondary)",
        border: "1px solid var(--surface-3)",
      }}
      title={artifact.content.slice(0, 200)}
    >
      {artifact.type === "diff" && <GitCompare size={9} />}
      {artifact.type === "file" && <FileText size={9} />}
      {artifact.type === "code" && <Terminal size={9} />}
      {artifact.type === "link" && <ArrowRight size={9} />}
      {artifact.label}
    </span>
  );
}

// ─── Message card ─────────────────────────────────────────────────────────────

function MessageCard({
  item,
  onToggleExpand,
  onOpenDetail,
  onMarkRead,
}: {
  item: SidecarItem;
  onToggleExpand: (id: string) => void;
  onOpenDetail: (item: SidecarItem) => void;
  onMarkRead: (id: string) => void;
}) {
  const isLong = isLongContent(item.body);
  const summary = buildSummary(item);
  const displayBody = item.expanded ? item.body : truncateBody(item.body);
  const needsTruncate = isLong && !item.expanded;
  const hasArtifacts = (item.artifacts?.length ?? 0) > 0;
  const hasToolUses = (item.toolUses?.length ?? 0) > 0;

  const isChat = item.kind === "chat";
  const isAlert = item.kind === "alert";
  const isReview =
    item.kind === "review_change" || item.kind === "review_decision";
  const isNarrate = item.kind === "narrate";

  const cardBg =
    isAlert && item.severity === "error"
      ? "rgba(194, 74, 74, 0.04)"
      : isAlert && item.severity === "warning"
        ? "rgba(245, 158, 11, 0.04)"
        : isAlert && item.severity === "success"
          ? "rgba(0, 134, 115, 0.04)"
          : isNarrate
            ? "rgba(167, 139, 250, 0.04)"
            : isReview
              ? "rgba(251, 191, 36, 0.03)"
              : "transparent";

  const leftBorderColor =
    isAlert && item.severity === "error"
      ? "var(--accent-rose)"
      : isAlert && item.severity === "warning"
        ? "#f59e0b"
        : isAlert
          ? "var(--accent-teal)"
          : isNarrate
            ? "#a78bfa"
            : isReview
              ? "#fbbf24"
              : "transparent";

  return (
    <div
      className={`px-3 py-2.5 border-b transition-colors group ${
        !item.read ? "cursor-pointer" : ""
      }`}
      style={{
        background: cardBg,
        borderLeft: `2px solid ${leftBorderColor}`,
        borderBottom: "1px solid var(--surface-3)",
      }}
      onClick={() => {
        if (!item.read) onMarkRead(item.id);
      }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
          {/* Unread dot */}
          {!item.read && (
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: "var(--accent-teal)" }}
            />
          )}

          {/* Severity + kind */}
          {isAlert && <SeverityIcon severity={item.severity ?? "info"} />}
          <KindBadge kind={item.kind} label={item.label} />

          {/* Session tag */}
          {item.sessionTitle && (
            <span
              className="text-[9px] px-1 py-0.5 rounded"
              style={{
                background: "var(--surface-2)",
                color: "var(--text-tertiary)",
              }}
            >
              {item.sessionTitle}
            </span>
          )}

          {/* Time */}
          <span
            className="text-[10px] shrink-0"
            style={{ color: "var(--text-tertiary)" }}
          >
            {item.tsLabel}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {/* Expand / collapse inline */}
          {isLong && (
            <button
              onClick={e => {
                e.stopPropagation();
                onToggleExpand(item.id);
              }}
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] transition-colors"
              style={{ color: "var(--text-tertiary)" }}
              title={item.expanded ? "Collapse" : "Expand inline"}
            >
              {item.expanded ? (
                <>
                  <ChevronUp size={11} />
                  <span>less</span>
                </>
              ) : (
                <>
                  <ChevronDown size={11} />
                  <span>more</span>
                </>
              )}
            </button>
          )}

          {/* Open in overlay */}
          <button
            onClick={e => {
              e.stopPropagation();
              onOpenDetail(item);
            }}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] transition-colors hover:opacity-80"
            style={{ color: "var(--text-tertiary)" }}
            title="Open in full overlay"
          >
            <Maximize2 size={11} />
          </button>
        </div>
      </div>

      {/* Summary line (always visible, for collapsed state) */}
      {!item.expanded && isLong && (
        <p
          className="text-xs leading-snug mb-1.5"
          style={{ color: "var(--text-secondary)" }}
        >
          {summary}
        </p>
      )}

      {/* Body */}
      <div
        className={`terminal-font text-[11px] leading-relaxed whitespace-pre-wrap ${
          !item.read ? "font-medium" : ""
        }`}
        style={{
          color: item.read ? "var(--text-secondary)" : "var(--text-primary)",
          fontFamily: isChat && item.role === "user" ? "inherit" : undefined,
        }}
      >
        {displayBody}
        {needsTruncate && (
          <button
            onClick={e => {
              e.stopPropagation();
              onToggleExpand(item.id);
            }}
            className="inline ml-1 underline underline-offset-2 text-[10px]"
            style={{ color: "var(--accent-teal)" }}
          >
            Show more
          </button>
        )}
      </div>

      {/* Tool uses row */}
      {hasToolUses && (item.expanded || item.inOverlay) && (
        <div className="flex flex-wrap gap-1 mt-2">
          {item.toolUses!.slice(0, 5).map((tool, i) => (
            <ToolUseBadge key={i} tool={tool} />
          ))}
          {item.toolUses!.length > 5 && (
            <span
              className="text-[10px] px-1 py-0.5 rounded"
              style={{
                background: "var(--surface-2)",
                color: "var(--text-tertiary)",
              }}
            >
              +{item.toolUses!.length - 5} more
            </span>
          )}
        </div>
      )}

      {/* Artifact chips */}
      {hasArtifacts && (item.expanded || item.inOverlay) && (
        <div className="flex flex-wrap gap-1 mt-2">
          {item.artifacts.map((a, i) => (
            <ArtifactChip key={i} artifact={a} />
          ))}
        </div>
      )}

      {/* Detail toggle (short content) */}
      {!isLong && (
        <button
          onClick={e => {
            e.stopPropagation();
            onOpenDetail(item);
          }}
          className="mt-1.5 text-[10px] flex items-center gap-1 opacity-0 group-hover:opacity-70 transition-opacity"
          style={{ color: "var(--accent-teal)" }}
        >
          <Maximize2 size={10} />
          Full detail
        </button>
      )}
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ filter }: { filter: SidecarFilter }) {
  const messages: Record<SidecarFilter, string> = {
    all: "No events yet. Start a terminal session or ask Pi.",
    chat: "No chat messages yet.",
    narrate: "No narration yet. Toggle narration on a terminal tab.",
    alerts: "All clear — no alerts.",
    review: "No review activity yet.",
  };
  const icons: Record<SidecarFilter, LucideIcon> = {
    all: Sparkles,
    chat: MessageSquare,
    narrate: Bot,
    alerts: Bell,
    review: GitCompare,
  };
  const Icon = icons[filter];
  return (
    <div
      className="flex flex-col items-center justify-center h-48 gap-2"
      style={{ color: "var(--text-tertiary)" }}
    >
      <Icon size={28} className="opacity-25" />
      <p className="text-xs text-center px-8">{messages[filter]}</p>
    </div>
  );
}

// ─── Main SidecarFeed component ───────────────────────────────────────────────

export default function SidecarFeed() {
  const { notifications, addPiMessage } = useAppStore();
  const [filter, setFilter] = useState<SidecarFilter>("all");
  // Seed with rich demo items always; overlay live notifications on top
  const [items, setItems] = useState<SidecarItem[]>(SEED_ITEMS);
  // Track which notification IDs we've injected to prevent duplicates
  const injectedIds = useRef<Set<string>>(new Set());
  const [detailItem, setDetailItem] = useState<SidecarItem | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [page, setPage] = useState(0);
  const [chatInput, setChatInput] = useState("");
  // True when user is typing — overlays collapse, pure chat mode
  const [inputActive, setInputActive] = useState(false);
  const ITEMS_PER_PAGE = 20;
  const feedRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  // Persistent notification badge counts (always computed from all items)
  const unreadAlerts = useMemo(
    () => items.filter(i => !i.read && i.kind === "alert").length,
    [items]
  );
  const unreadNarration = useMemo(
    () => items.filter(i => !i.read && i.kind === "narrate").length,
    [items]
  );
  const unreadReview = useMemo(
    () =>
      items.filter(
        i =>
          !i.read &&
          (i.kind === "review_change" || i.kind === "review_decision")
      ).length,
    [items]
  );

  // Filtered items — chat is always the base layer.
  // When inputActive or filter=chat: show only chat (overlays collapse).
  // Otherwise: show items matching the active filter.
  const filteredItems = useMemo(() => {
    if (inputActive || filter === "chat") {
      return items.filter(i => i.kind === "chat");
    }
    if (filter === "all") return items;
    const kindFilter =
      filter === "narrate"
        ? (k: SidecarItemKind) => k === "narrate"
        : filter === "alerts"
          ? (k: SidecarItemKind) => k === "alert"
          : (k: SidecarItemKind) =>
              k === "review_change" || k === "review_decision";
    return items.filter(i => kindFilter(i.kind));
  }, [items, filter, inputActive]);

  const visibleItems = useMemo(
    () => filteredItems.slice(0, (page + 1) * ITEMS_PER_PAGE),
    [filteredItems, page]
  );
  const hasMore = filteredItems.length > visibleItems.length;

  // Live: inject new notifications as sidecar items
  useEffect(() => {
    const seed = notifications;
    if (!seed || seed.length === 0) return;
    // Use ref to dedup across renders without needing items in deps
    const toAdd = seed.filter(n => !injectedIds.current.has(n.id));
    if (toAdd.length === 0) return;
    const newItems: SidecarItem[] = toAdd.map(n => {
      injectedIds.current.add(n.id);
      return {
        id: n.id,
        kind: (n.kind === "review"
          ? "review_change"
          : n.kind === "agent"
            ? "narrate"
            : n.kind === "system"
              ? "system"
              : "alert") as SidecarItemKind,
        label:
          n.kind === "review"
            ? "Review"
            : n.kind === "agent"
              ? "Narration"
              : n.kind === "system"
                ? "System"
                : "Alert",
        ts:
          new Date(n.ts).getTime() > 0
            ? new Date(n.ts).toISOString()
            : String(Date.now()),
        tsLabel: n.ts,
        summary: n.title,
        body: n.body,
        severity:
          n.kind === "review"
            ? ("warning" as const)
            : n.kind === "system"
              ? ("info" as const)
              : ("warning" as const),
        alertLabel: n.kind === "review" ? "Review" : "Alert",
        artifacts: [],
        read: n.read,
        expanded: false,
        inOverlay: false,
      };
    });
    setItems(prev => [...newItems, ...prev]);
  }, [notifications]);

  const toggleExpand = useCallback((id: string) => {
    setItems(prev =>
      prev.map(i => (i.id === id ? { ...i, expanded: !i.expanded } : i))
    );
    // If expanded item is in overlay, sync overlay
    setDetailItem(prev => {
      if (prev?.id === id) return { ...prev, expanded: !prev.expanded };
      return prev;
    });
  }, []);

  const markRead = useCallback((id: string) => {
    setItems(prev => prev.map(i => (i.id === id ? { ...i, read: true } : i)));
  }, []);

  const openDetail = useCallback((item: SidecarItem) => {
    setItems(prev =>
      prev.map(i => (i.id === item.id ? { ...i, inOverlay: true } : i))
    );
    setDetailItem({ ...item, inOverlay: true });
  }, []);

  const closeDetail = useCallback(() => {
    if (detailItem) {
      setItems(prev =>
        prev.map(i => (i.id === detailItem.id ? { ...i, inOverlay: false } : i))
      );
    }
    setDetailItem(null);
  }, [detailItem]);

  const loadMore = useCallback(() => {
    setIsLoadingHistory(true);
    // Simulate loading older items from journal
    setTimeout(() => {
      setPage(p => p + 1);
      setIsLoadingHistory(false);
    }, 600);
  }, []);

  // ── Chat input bar ──────────────────────────────────────────────────────
  const handleSendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    const newItem: SidecarItem = {
      id: `chat-${Date.now()}`,
      kind: "chat",
      label: "Chat",
      ts: new Date().toISOString(),
      tsLabel: "just now",
      summary: text,
      body: text,
      role: "user",
      artifacts: [],
      read: false,
      expanded: false,
      inOverlay: false,
    };
    setItems(prev => [newItem, ...prev]);
    setChatInput("");
    // Keep overlay collapsed after send — stays in chat-only mode
    // Wire to store so Pi can process it
    addPiMessage?.({
      id: `user-${Date.now()}`,
      role: "user" as const,
      text,
      type: "chat" as const,
    });
  }, [chatInput, addPiMessage]);

  const handleChatKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendChat();
      }
    },
    [handleSendChat]
  );

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{
        background: "var(--surface-1)",
      }}
    >
      {/* ── Header with filter chips ── */}
      <div
        className="shrink-0 px-3 pt-3 pb-2"
        style={{ borderBottom: "1px solid var(--surface-3)" }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Terminal size={13} style={{ color: "var(--accent-teal)" }} />
            <span
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-secondary)" }}
            >
              Feed
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* Mark all read */}
            {items.some(i => !i.read) && (
              <button
                onClick={() =>
                  setItems(prev => prev.map(i => ({ ...i, read: true })))
                }
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ color: "var(--text-tertiary)" }}
                title="Mark all as read"
              >
                <CheckCircle2 size={11} />
              </button>
            )}
          </div>
        </div>

        {/* Filter chips — notification badges always visible even in chat-only mode */}
        <div className="flex items-center gap-1 flex-wrap">
          {/* Chat chip: always shows unread chat count */}
          <button
            key="chat"
            onClick={() => {
              setFilter("chat");
              setInputActive(true);
              setPage(0);
              chatInputRef.current?.focus();
            }}
            className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-all duration-150"
            style={{
              background:
                filter === "chat" || inputActive
                  ? "var(--accent-teal)"
                  : "var(--surface-2)",
              color:
                filter === "chat" || inputActive
                  ? "#fff"
                  : "var(--text-tertiary)",
              border:
                filter === "chat" || inputActive
                  ? "none"
                  : "1px solid var(--surface-3)",
            }}
          >
            <MessageSquare size={10} />
            Chat
            {(() => {
              const unread = items.filter(
                i => !i.read && i.kind === "chat"
              ).length;
              return unread > 0 ? (
                <span
                  className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
                  style={{
                    background:
                      filter === "chat" || inputActive
                        ? "rgba(255,255,255,0.25)"
                        : "var(--accent-teal)",
                    color: "#fff",
                  }}
                >
                  {unread > 9 ? "9+" : unread}
                </span>
              ) : null;
            })()}
          </button>

          {/* Overlay chips — Narrate/Alerts/Review replaced by dots in chat-only mode */}
          {/* "All" always shown so user can always return to full overlay view */}
          {(() => {
            const isAllActive = !inputActive && filter === "all";
            return (
              <button
                key="all"
                onClick={() => {
                  setFilter("all");
                  setInputActive(false);
                  setPage(0);
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-all duration-150"
                style={{
                  background: isAllActive
                    ? "var(--text-secondary)"
                    : "var(--surface-2)",
                  color: isAllActive ? "#fff" : "var(--text-tertiary)",
                  border: isAllActive ? "none" : "1px solid var(--surface-3)",
                }}
              >
                <Sparkles size={10} />
                All
              </button>
            );
          })()}

          {/* Category-specific overlay chips, or notification dots when in chat-only mode */}
          {!inputActive && filter !== "chat" ? (
            <>
              {FILTER_CONFIG.filter(f => f.key !== "all").map(
                ({ key, label, icon: Icon, color }) => {
                  const isActive = filter === key;
                  const badge =
                    key === "alerts" && unreadAlerts > 0
                      ? unreadAlerts
                      : key === "narrate" && unreadNarration > 0
                        ? unreadNarration
                        : key === "review" && unreadReview > 0
                          ? unreadReview
                          : 0;
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        setFilter(key);
                        setInputActive(false);
                        setPage(0);
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-all duration-150"
                      style={{
                        background: isActive ? color : "var(--surface-2)",
                        color: isActive ? "#fff" : "var(--text-tertiary)",
                        border: isActive
                          ? "none"
                          : "1px solid var(--surface-3)",
                      }}
                    >
                      <Icon size={10} />
                      {label}
                      {badge > 0 && (
                        <span
                          className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
                          style={{
                            background: isActive
                              ? "rgba(255,255,255,0.25)"
                              : "var(--accent-teal)",
                            color: "#fff",
                          }}
                        >
                          {badge > 9 ? "9+" : badge}
                        </span>
                      )}
                    </button>
                  );
                }
              )}
            </>
          ) : (
            /* When in chat-only mode: show notification dots for overlay types */
            <>
              {unreadNarration > 0 && (
                <span
                  className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium"
                  style={{
                    background: "var(--surface-2)",
                    color: "var(--text-tertiary)",
                    border: "1px solid var(--surface-3)",
                  }}
                  title={`${unreadNarration} unread narration`}
                >
                  <Bot size={10} style={{ color: "#a78bfa" }} />
                  <span
                    className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold"
                    style={{ background: "#a78bfa", color: "#fff" }}
                  >
                    {unreadNarration}
                  </span>
                </span>
              )}
              {unreadAlerts > 0 && (
                <span
                  className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium"
                  style={{
                    background: "var(--surface-2)",
                    color: "var(--text-tertiary)",
                    border: "1px solid var(--surface-3)",
                  }}
                  title={`${unreadAlerts} unread alerts`}
                >
                  <Bell size={10} style={{ color: "#fb923c" }} />
                  <span
                    className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold"
                    style={{ background: "#fb923c", color: "#fff" }}
                  >
                    {unreadAlerts}
                  </span>
                </span>
              )}
              {unreadReview > 0 && (
                <span
                  className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium"
                  style={{
                    background: "var(--surface-2)",
                    color: "var(--text-tertiary)",
                    border: "1px solid var(--surface-3)",
                  }}
                  title={`${unreadReview} unread review`}
                >
                  <GitCompare size={10} style={{ color: "#fbbf24" }} />
                  <span
                    className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold"
                    style={{ background: "#fbbf24", color: "#fff" }}
                  >
                    {unreadReview}
                  </span>
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Scrollable message list ── */}
      <div ref={feedRef} className="flex-1 overflow-y-auto wenmei-scroll">
        {filteredItems.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          <>
            {visibleItems.map(item => (
              <MessageCard
                key={item.id}
                item={item}
                onToggleExpand={toggleExpand}
                onOpenDetail={openDetail}
                onMarkRead={markRead}
              />
            ))}

            {/* Load more */}
            {hasMore && (
              <div className="flex justify-center py-3">
                <button
                  onClick={loadMore}
                  disabled={isLoadingHistory}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-200 disabled:opacity-50"
                  style={{
                    background: "var(--surface-2)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--surface-3)",
                  }}
                >
                  {isLoadingHistory ? (
                    <>
                      <Loader2 size={11} className="animate-spin" />
                      Loading…
                    </>
                  ) : (
                    <>
                      <RefreshCw size={11} />
                      Load older
                    </>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Persistent chat input bar ── */}
      <div
        className="shrink-0 px-3 py-2"
        style={{ borderTop: "1px solid var(--surface-3)" }}
      >
        <div
          className="flex items-end gap-2 rounded-lg p-2"
          style={{
            background: "var(--surface-0)",
            border: "1px solid var(--surface-3)",
          }}
        >
          {/* Attachment button */}
          <button
            title="Attach files (@ to reference in text)"
            className="flex items-center justify-center w-7 h-7 rounded-md shrink-0 transition-all duration-150 hover:opacity-80"
            style={{ color: "var(--text-tertiary)" }}
            onClick={() => {
              // TODO: open file picker (requires Tauri dialog)
              chatInputRef.current?.focus();
            }}
          >
            <Paperclip size={13} />
          </button>

          {/* Chat textarea */}
          <textarea
            ref={chatInputRef}
            value={chatInput}
            onChange={e => {
              setChatInput(e.target.value);
              if (e.target.value) setInputActive(true);
            }}
            onFocus={() => setInputActive(true)}
            onBlur={() => {
              // Only blur-reset if empty; if user typed something, keep active
              if (!chatInput.trim()) setInputActive(false);
            }}
            onKeyDown={handleChatKeyDown}
            placeholder="Ask about your code, @ to attach files…"
            className="flex-1 bg-transparent outline-none resize-none text-xs terminal-font"
            style={{
              color: "var(--text-primary)",
              minHeight: "36px",
              maxHeight: "120px",
              overflowY: "auto",
              lineHeight: "18px",
            }}
            rows={1}
          />

          {/* Send button */}
          <button
            onClick={handleSendChat}
            disabled={!chatInput.trim()}
            className="flex items-center justify-center w-7 h-7 rounded-md shrink-0 transition-all duration-200 disabled:opacity-40"
            style={{
              background: chatInput.trim()
                ? "var(--accent-teal)"
                : "var(--surface-2)",
              color: chatInput.trim() ? "#fff" : "var(--text-tertiary)",
            }}
          >
            <Send size={12} />
          </button>
        </div>

        {/* Attached files strip */}
        {/* (wired to @ mentions — shows inline when files are referenced) */}
      </div>

      {/* ── Detail overlay ── */}
      {detailItem && <SidecarDetail item={detailItem} onClose={closeDetail} />}
    </div>
  );
}
