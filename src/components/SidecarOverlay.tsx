import { useState } from "react";
import { Bell, Bot, GitCompare, MessageSquare, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  isLongContent,
  truncateBody,
  type AlertSeverity,
  type SidecarItem,
} from "@/lib/sidecar-types";
import {
  FILTER_CONFIG,
  relTime,
  type AlertGroup,
  type FeedFilter,
} from "@/lib/sidecar-feed";
import { approvePrompt, currentPrompt } from "@/lib/tauri-bridge";

// ─── Overlay layer for the unified sidecar feed (docs/design/unified-sidecar.md)
// Chat stays the untouched base layer in PiPanel; these cards stack above it.
// Non-component helpers live in lib/sidecar-feed.ts.

function SeverityDot({ severity }: { severity: AlertSeverity }) {
  const color =
    severity === "error"
      ? "var(--accent-rose)"
      : severity === "warning"
        ? "#f59e0b"
        : severity === "success"
          ? "var(--accent-teal)"
          : "var(--text-tertiary)";
  return (
    <span
      className="w-2 h-2 rounded-full shrink-0"
      style={{ background: color }}
    />
  );
}

export function OverlayCard({
  item,
  onMarkRead,
  onOpen,
}: {
  item: SidecarItem;
  onMarkRead: (id: string) => void;
  onOpen?: (item: SidecarItem) => void;
}) {
  const isAlert = item.kind === "alert";
  const isNarrate = item.kind === "narrate";
  const isReview =
    item.kind === "review_change" || item.kind === "review_decision";

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

  const kindColor = isNarrate ? "#a78bfa" : isAlert ? "#fb923c" : "#fbbf24";

  return (
    <div
      className="px-3 py-2 transition-colors cursor-pointer"
      style={{
        background: cardBg,
        borderLeft: `2px solid ${leftBorderColor}`,
        borderBottom: "1px solid var(--surface-3)",
      }}
      onClick={() => {
        if (!item.read) onMarkRead(item.id);
        onOpen?.(item);
      }}
    >
      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
        {!item.read && (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: "var(--accent-teal)" }}
          />
        )}
        {isAlert && <SeverityDot severity={item.severity ?? "info"} />}
        <span
          className="text-[9px] font-semibold uppercase tracking-wider"
          style={{ color: kindColor }}
        >
          {item.label}
        </span>
        {item.sessionId && (
          <span
            className="text-[9px] px-1 py-0.5 rounded"
            style={{
              background: "var(--surface-2)",
              color: "var(--text-tertiary)",
            }}
          >
            {item.sessionTitle ?? item.sessionId}
          </span>
        )}
        <span
          className="text-[9px] ml-auto shrink-0"
          style={{ color: "var(--text-tertiary)" }}
        >
          {relTime(item.ts)}
        </span>
      </div>
      {isNarrate ? (
        <>
          {/* Teaser: the lead-in only — the full narration lives in the
              detail overlay behind the link (and the card click). */}
          <div
            className="text-[11px] leading-relaxed break-words line-clamp-2"
            style={{ color: "var(--text-secondary)" }}
          >
            {item.body}
          </div>
          <button
            onClick={e => {
              e.stopPropagation();
              if (!item.read) onMarkRead(item.id);
              onOpen?.(item);
            }}
            className="mt-1 text-[10px] font-medium hover:underline"
            style={{ color: "#a78bfa" }}
          >
            Read full narration →
          </button>
        </>
      ) : (
        <div
          className="text-[11px] leading-relaxed whitespace-pre-wrap break-words"
          style={{ color: "var(--text-secondary)" }}
        >
          {item.expanded || !isLongContent(item.body)
            ? item.body
            : truncateBody(item.body)}
        </div>
      )}

      {/* Approval relay (H10): input.needs_response carries hands. */}
      {item.alertLabel === "input.needs_response" && <ApprovalActions />}
    </div>
  );
}

function ApprovalActions() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "moved">(
    "idle"
  );

  async function answer(allow: boolean) {
    if (state === "sending") return;
    setState("sending");
    try {
      // Re-derive pattern + screen hash at click time (verify-then-act).
      const prompt = await currentPrompt();
      if (!prompt) {
        setState("moved");
        return;
      }
      await approvePrompt(prompt.pattern_id, allow, prompt.screen_hash);
      setState("done");
    } catch {
      setState("moved");
    }
  }

  if (state === "done") {
    return (
      <div
        className="mt-1.5 text-[10px]"
        style={{ color: "var(--accent-teal)" }}
      >
        Sent — journaled as steering.injected
      </div>
    );
  }
  if (state === "moved") {
    return (
      <div className="mt-1.5 text-[10px]" style={{ color: "#f59e0b" }}>
        Prompt moved — nothing sent. Open the terminal.
      </div>
    );
  }

  return (
    <div
      className="mt-1.5 flex items-center gap-1.5"
      onClick={e => e.stopPropagation()}
    >
      <button
        onClick={() => answer(true)}
        disabled={state === "sending"}
        className="px-2 py-0.5 rounded text-[10px] font-medium disabled:opacity-60"
        style={{ background: "var(--accent-teal)", color: "#fff" }}
      >
        Allow
      </button>
      <button
        onClick={() => answer(false)}
        disabled={state === "sending"}
        className="px-2 py-0.5 rounded text-[10px] font-medium disabled:opacity-60"
        style={{
          background: "var(--surface-2)",
          color: "var(--text-secondary)",
        }}
      >
        Deny
      </button>
    </div>
  );
}

/** Collapses repeat alerts sharing an alertLabel (see groupFeedItems) into
 *  one card: the latest alert's content, a "×N" count pill, and a "Clear
 *  all" link that drops the whole group from the feed. */
export function AlertGroupCard({
  group,
  onMarkRead,
  onOpen,
  onClearGroup,
}: {
  group: AlertGroup;
  onMarkRead: (id: string) => void;
  onOpen?: (item: SidecarItem) => void;
  onClearGroup: (alertLabel: string) => void;
}) {
  const latest = group.items[0];
  const count = group.items.length;

  const cardBg =
    latest.severity === "error"
      ? "rgba(194, 74, 74, 0.04)"
      : latest.severity === "warning"
        ? "rgba(245, 158, 11, 0.04)"
        : latest.severity === "success"
          ? "rgba(0, 134, 115, 0.04)"
          : "transparent";

  const leftBorderColor =
    latest.severity === "error"
      ? "var(--accent-rose)"
      : latest.severity === "warning"
        ? "#f59e0b"
        : "var(--accent-teal)";

  return (
    <div
      className="px-3 py-2 transition-colors cursor-pointer"
      style={{
        background: cardBg,
        borderLeft: `2px solid ${leftBorderColor}`,
        borderBottom: "1px solid var(--surface-3)",
      }}
      onClick={() => {
        for (const item of group.items) {
          if (!item.read) onMarkRead(item.id);
        }
        onOpen?.(latest);
      }}
    >
      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
        {group.items.some(i => !i.read) && (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: "var(--accent-teal)" }}
          />
        )}
        <SeverityDot severity={latest.severity ?? "info"} />
        <span
          className="text-[9px] font-semibold uppercase tracking-wider"
          style={{ color: "#fb923c" }}
        >
          {latest.label}
        </span>
        <span
          className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
          style={{
            background: "var(--surface-2)",
            color: "var(--text-secondary)",
          }}
          title={`${count} alerts of this kind`}
        >
          ×{count}
        </span>
        {latest.sessionId && (
          <span
            className="text-[9px] px-1 py-0.5 rounded"
            style={{
              background: "var(--surface-2)",
              color: "var(--text-tertiary)",
            }}
          >
            {latest.sessionTitle ?? latest.sessionId}
          </span>
        )}
        <span
          className="text-[9px] ml-auto shrink-0"
          style={{ color: "var(--text-tertiary)" }}
        >
          {relTime(latest.ts)}
        </span>
      </div>
      <div
        className="text-[11px] leading-relaxed whitespace-pre-wrap break-words"
        style={{ color: "var(--text-secondary)" }}
      >
        {latest.expanded || !isLongContent(latest.body)
          ? latest.body
          : truncateBody(latest.body)}
      </div>

      {latest.alertLabel === "input.needs_response" && <ApprovalActions />}

      <button
        onClick={e => {
          e.stopPropagation();
          onClearGroup(group.alertLabel);
        }}
        className="mt-1 text-[10px] font-medium hover:underline"
        style={{ color: "var(--text-tertiary)" }}
      >
        Clear all ({count})
      </button>
    </div>
  );
}

interface FeedChipsProps {
  filter: FeedFilter;
  inputActive: boolean;
  unreadChat: number;
  unreadNarration: number;
  unreadAlerts: number;
  unreadReview: number;
  onSelect: (filter: FeedFilter) => void;
  onChatFocus: () => void;
}

export function FeedChips({
  filter,
  inputActive,
  unreadChat,
  unreadNarration,
  unreadAlerts,
  unreadReview,
  onSelect,
  onChatFocus,
}: FeedChipsProps) {
  const chatActive = filter === "chat" || inputActive;
  const badgeFor = (key: string) =>
    key === "narrate"
      ? unreadNarration
      : key === "alerts"
        ? unreadAlerts
        : key === "review"
          ? unreadReview
          : 0;

  const dot = (
    count: number,
    Icon: LucideIcon,
    color: string,
    label: string
  ) =>
    count > 0 ? (
      <span
        key={label}
        className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium"
        style={{
          background: "var(--surface-2)",
          color: "var(--text-tertiary)",
          border: "1px solid var(--surface-3)",
        }}
        title={`${count} unread ${label}`}
      >
        <Icon size={10} style={{ color }} />
        <span
          className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold"
          style={{ background: color, color: "#fff" }}
        >
          {count > 9 ? "9+" : count}
        </span>
      </span>
    ) : null;

  return (
    <div
      className="flex items-center gap-1 px-3 py-1.5 flex-wrap"
      style={{
        borderBottom: "1px solid var(--surface-3)",
        background: "var(--surface-0)",
      }}
    >
      {/* Chat — always shown */}
      <button
        onClick={() => {
          onSelect("chat");
          onChatFocus();
        }}
        className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-all duration-150"
        style={{
          background: chatActive ? "var(--accent-teal)" : "var(--surface-2)",
          color: chatActive ? "#fff" : "var(--text-tertiary)",
          border: chatActive ? "none" : "1px solid var(--surface-3)",
        }}
      >
        <MessageSquare size={10} />
        Chat
        {unreadChat > 0 && (
          <span
            className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
            style={{
              background: chatActive
                ? "rgba(255,255,255,0.25)"
                : "var(--accent-teal)",
              color: "#fff",
            }}
          >
            {unreadChat > 9 ? "9+" : unreadChat}
          </span>
        )}
      </button>

      {/* All — always shown, the way back to full overlay view */}
      <button
        onClick={() => onSelect("all")}
        className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-all duration-150"
        style={{
          background:
            !inputActive && filter === "all"
              ? "var(--text-secondary)"
              : "var(--surface-2)",
          color:
            !inputActive && filter === "all" ? "#fff" : "var(--text-tertiary)",
          border:
            !inputActive && filter === "all"
              ? "none"
              : "1px solid var(--surface-3)",
        }}
      >
        <Sparkles size={10} />
        All
      </button>

      {/* Overlay chips, or unread dots in chat-only mode */}
      {!inputActive && filter !== "chat" ? (
        FILTER_CONFIG.filter(f => f.key !== "all").map(
          ({ key, label, icon: Icon, color }) => {
            const isActive = filter === key;
            const badge = badgeFor(key);
            return (
              <button
                key={key}
                onClick={() => onSelect(key)}
                className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-all duration-150"
                style={{
                  background: isActive ? color : "var(--surface-2)",
                  color: isActive ? "#fff" : "var(--text-tertiary)",
                  border: isActive ? "none" : "1px solid var(--surface-3)",
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
        )
      ) : (
        <>
          {dot(unreadNarration, Bot, "#a78bfa", "narration")}
          {dot(unreadAlerts, Bell, "#fb923c", "alerts")}
          {dot(unreadReview, GitCompare, "#fbbf24", "review")}
        </>
      )}
    </div>
  );
}
