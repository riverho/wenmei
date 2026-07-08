import { useCallback, useEffect, useRef, useState } from "react";
import { readFile } from "@/lib/tauri-bridge";
import {
  buildSummary,
  extractArtifacts,
  extractFileRefs,
  type SidecarArtifact,
  type SidecarItem,
  type SidecarDiffLine,
} from "@/lib/sidecar-types";
import {
  X,
  Terminal,
  FileText,
  ExternalLink,
  Copy,
  Check,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Bot,
  AlertTriangle,
  GitCompare,
  MessageSquare,
  Zap,
} from "lucide-react";

// ─── Diff viewer ─────────────────────────────────────────────────────────────

function DiffViewer({ lines }: { lines: SidecarDiffLine[] }) {
  const [collapsed, setCollapsed] = useState(lines.length > 20);
  const shown = collapsed ? lines.slice(0, 20) : lines;
  const removed = lines.filter(l => l.type === "old").length;
  const added = lines.filter(l => l.type === "new").length;

  return (
    <div
      className="rounded-lg overflow-hidden border"
      style={{
        borderColor: "var(--surface-3)",
        background: "var(--surface-0)",
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-1.5 text-[10px]"
        style={{
          background: "var(--surface-2)",
          color: "var(--text-tertiary)",
        }}
      >
        <span className="flex items-center gap-2">
          <GitCompare size={10} />
          <span>{lines.length} lines</span>
          {added > 0 && (
            <span style={{ color: "var(--accent-teal)" }}>+{added}</span>
          )}
          {removed > 0 && (
            <span style={{ color: "var(--accent-rose)" }}>−{removed}</span>
          )}
        </span>
        {lines.length > 20 && (
          <button
            onClick={() => setCollapsed(c => !c)}
            className="flex items-center gap-1 hover:opacity-80"
          >
            {collapsed ? (
              <>
                <ChevronDown size={10} />
                Show all
              </>
            ) : (
              <>
                <ChevronUp size={10} />
                Collapse
              </>
            )}
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] terminal-font">
          <tbody>
            {shown.map((line, i) => (
              <tr key={i}>
                <td
                  className="w-4 px-2 py-0.5 text-right select-none"
                  style={{
                    color:
                      line.type === "new"
                        ? "var(--accent-teal)"
                        : line.type === "old"
                          ? "var(--accent-rose)"
                          : "var(--text-tertiary)",
                    background:
                      line.type === "new"
                        ? "rgba(0, 134, 115, 0.08)"
                        : line.type === "old"
                          ? "rgba(194, 74, 74, 0.08)"
                          : "transparent",
                  }}
                >
                  {line.type === "new" ? "+" : line.type === "old" ? "−" : " "}
                </td>
                <td
                  className="px-3 py-0.5 whitespace-pre"
                  style={{
                    color:
                      line.type === "new"
                        ? "var(--accent-teal)"
                        : line.type === "old"
                          ? "var(--accent-rose)"
                          : "var(--text-secondary)",
                    background:
                      line.type === "new"
                        ? "rgba(0, 134, 115, 0.06)"
                        : line.type === "old"
                          ? "rgba(194, 74, 74, 0.06)"
                          : "transparent",
                  }}
                >
                  {line.text || " "}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Code block viewer ───────────────────────────────────────────────────────

function CodeBlock({ artifact }: { artifact: SidecarArtifact }) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(
    artifact.content.split("\n").length > 20
  );

  const lines = artifact.content.split("\n");
  const shown = collapsed ? lines.slice(0, 20) : lines;

  const handleCopy = () => {
    navigator.clipboard.writeText(artifact.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="rounded-lg overflow-hidden border"
      style={{ borderColor: "var(--surface-3)" }}
    >
      <div
        className="flex items-center justify-between px-3 py-1.5 text-[10px]"
        style={{
          background: "var(--surface-2)",
          color: "var(--text-tertiary)",
        }}
      >
        <span className="flex items-center gap-1.5">
          <Terminal size={10} />
          <span>{artifact.language || "code"}</span>
          <span>·</span>
          <span>{lines.length} lines</span>
        </span>
        <div className="flex items-center gap-2">
          {lines.length > 20 && (
            <button
              onClick={() => setCollapsed(c => !c)}
              className="hover:opacity-80 flex items-center gap-1"
            >
              {collapsed ? (
                <>
                  <ChevronDown size={10} />
                  Expand
                </>
              ) : (
                <>
                  <ChevronUp size={10} />
                  Collapse
                </>
              )}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="hover:opacity-80 flex items-center gap-1"
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre
        className="overflow-x-auto p-3 text-[11px] terminal-font leading-relaxed wenmei-scroll"
        style={{ background: "var(--syntax-bg)", color: "var(--text-primary)" }}
      >
        <code>{shown.join("\n")}</code>
        {collapsed && (
          <span style={{ color: "var(--text-tertiary)" }}>
            {"\n"}({lines.length - 20} more lines…{"}"}
          </span>
        )}
      </pre>
    </div>
  );
}

// ─── File ref chip ───────────────────────────────────────────────────────────

function FileRefChip({ path }: { path: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const handleOpen = () => {
    if (!open) {
      readFile(path)
        .then(f => setContent(f.content))
        .catch(() => setContent("[File not found]"));
      setOpen(true);
    } else {
      setOpen(false);
      setContent(null);
    }
  };

  return (
    <div
      className="rounded border overflow-hidden"
      style={{ borderColor: "var(--surface-3)" }}
    >
      <button
        onClick={handleOpen}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left text-[11px] hover:opacity-80 transition-opacity"
        style={{
          background: "var(--surface-2)",
          color: "var(--text-secondary)",
        }}
      >
        <FileText size={11} style={{ color: "var(--accent-teal)" }} />
        <span className="font-mono flex-1 truncate">{path}</span>
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>
      {open && content !== null && (
        <pre
          className="p-3 text-[11px] terminal-font whitespace-pre-wrap max-h-48 overflow-y-auto wenmei-scroll"
          style={{
            background: "var(--surface-0)",
            color: "var(--text-secondary)",
            borderTop: "1px solid var(--surface-3)",
          }}
        >
          {content}
        </pre>
      )}
    </div>
  );
}

// ─── History list ─────────────────────────────────────────────────────────────

function HistoryList({
  item,
  allItems,
}: {
  item: SidecarItem;
  allItems: SidecarItem[];
}) {
  // Show items from the same session, or related review items
  const related = allItems
    .filter(
      i =>
        i.id !== item.id &&
        (i.sessionId === item.sessionId ||
          i.reviewSessionId === item.reviewSessionId ||
          i.kind === item.kind)
    )
    .slice(0, 8);

  if (related.length === 0) return null;

  return (
    <div
      className="rounded border overflow-hidden"
      style={{ borderColor: "var(--surface-3)" }}
    >
      <div
        className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider"
        style={{
          background: "var(--surface-2)",
          color: "var(--text-tertiary)",
        }}
      >
        Related history
      </div>
      <div className="divide-y" style={{ borderColor: "var(--surface-3)" }}>
        {related.map(r => (
          <div
            key={r.id}
            className="flex items-start gap-2 px-3 py-2 hover:opacity-80 cursor-pointer transition-opacity"
            onClick={() => {
              // In a real implementation, this would navigate to the related item
            }}
          >
            <span
              className="text-[9px] font-medium mt-0.5 shrink-0"
              style={{ color: "var(--text-tertiary)" }}
            >
              {r.tsLabel}
            </span>
            <span
              className="text-[11px] flex-1 truncate"
              style={{ color: "var(--text-secondary)" }}
            >
              {buildSummary(r)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main SidecarDetail component ──────────────────────────────────────────────

export default function SidecarDetail({
  item,
  onClose,
}: {
  item: SidecarItem;
  onClose: () => void;
}) {
  // History items — passed from parent SidecarFeed which owns the item list
  const allItems: SidecarItem[] = [];
  const [activeArtifact, setActiveArtifact] = useState<SidecarArtifact | null>(
    item.artifacts[0] ?? null
  );
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Close on backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  // Parse diff lines from artifact content
  const diffLines: SidecarDiffLine[] =
    activeArtifact?.type === "diff"
      ? item.body
          .split("\n")
          .filter(l => l.startsWith("+") || l.startsWith("-"))
          .map(l => ({
            type: l.startsWith("+") ? ("new" as const) : ("old" as const),
            text: l.slice(1),
          }))
      : [];

  const bodyArtifacts = extractArtifacts(item.body);
  const fileRefs = extractFileRefs(item.body);

  // Determine the main content type for the primary viewer
  const primaryArtifact = activeArtifact ?? bodyArtifacts[0] ?? null;
  const showDiff = primaryArtifact?.type === "diff" || diffLines.length > 0;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4 md:p-8"
      onClick={handleBackdropClick}
      style={{
        background: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        animation:
          "sidecar-detail-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards",
      }}
    >
      {/* Panel */}
      <div
        ref={overlayRef}
        className="relative flex flex-col overflow-hidden rounded-2xl shadow-2xl"
        style={{
          width: "min(900px, 96vw)",
          height: "min(700px, 90vh)",
          background: "var(--surface-1)",
          border: "1px solid var(--surface-3)",
          animation:
            "sidecar-detail-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Panel header ── */}
        <div
          className="flex items-center justify-between shrink-0 px-5 py-3"
          style={{ borderBottom: "1px solid var(--surface-3)" }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Kind icon */}
            {item.kind === "chat" && (
              <MessageSquare
                size={15}
                style={{ color: "var(--accent-teal)" }}
              />
            )}
            {item.kind === "narrate" && (
              <Bot size={15} style={{ color: "#a78bfa" }} />
            )}
            {item.kind === "alert" && (
              <AlertTriangle size={15} style={{ color: "#fb923c" }} />
            )}
            {item.kind === "review_change" && (
              <GitCompare size={15} style={{ color: "#fbbf24" }} />
            )}
            {item.kind === "terminal_stdio" && (
              <Terminal size={15} style={{ color: "var(--text-tertiary)" }} />
            )}
            {item.kind === "system" && (
              <Zap size={15} style={{ color: "var(--text-tertiary)" }} />
            )}

            <div className="min-w-0">
              <h2
                className="text-sm font-semibold truncate"
                style={{ color: "var(--text-primary)" }}
              >
                {buildSummary(item)}
              </h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span
                  className="text-[10px]"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {item.tsLabel}
                </span>
                {item.sessionTitle && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{
                      background: "var(--surface-2)",
                      color: "var(--text-tertiary)",
                    }}
                  >
                    {item.sessionTitle}
                  </span>
                )}
                {item.reviewSessionId && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{
                      background: "rgba(251, 191, 36, 0.1)",
                      color: "#fbbf24",
                    }}
                  >
                    {item.reviewSessionId}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-150 hover:-translate-y-0.5 shrink-0 ml-3"
            style={{ color: "var(--text-tertiary)" }}
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Main content */}
          <div className="flex-1 overflow-y-auto wenmei-scroll p-5 space-y-4">
            {/* Body text */}
            <div>
              <div
                className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: "var(--text-tertiary)" }}
              >
                Message
              </div>
              <div
                className="text-sm leading-relaxed whitespace-pre-wrap"
                style={{ color: "var(--text-secondary)" }}
              >
                {item.body}
              </div>
            </div>

            {/* Diff viewer */}
            {showDiff && diffLines.length > 0 && (
              <div>
                <div
                  className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  Changes
                </div>
                <DiffViewer lines={diffLines} />
              </div>
            )}

            {/* Code blocks */}
            {bodyArtifacts
              .filter(a => a.type === "code")
              .map((artifact, i) => (
                <div key={i}>
                  <div
                    className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    Code · {artifact.language}
                  </div>
                  <CodeBlock artifact={artifact} />
                </div>
              ))}

            {/* File references */}
            {fileRefs.length > 0 && (
              <div>
                <div
                  className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  Referenced files
                </div>
                <div className="space-y-1">
                  {fileRefs.map((path, i) => (
                    <FileRefChip key={i} path={path} />
                  ))}
                </div>
              </div>
            )}

            {/* Tool uses */}
            {item.toolUses && item.toolUses.length > 0 && (
              <div>
                <div
                  className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  Tool calls · {item.toolUses.length}
                </div>
                <div className="space-y-1">
                  {item.toolUses.map((tool, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-3 py-1.5 rounded text-[11px]"
                      style={{
                        background: "var(--surface-2)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{
                          background:
                            tool.status === "done"
                              ? "var(--accent-teal)"
                              : tool.status === "error"
                                ? "var(--accent-rose)"
                                : "var(--text-tertiary)",
                        }}
                      />
                      <span className="font-mono flex-1">{tool.name}</span>
                      {tool.duration_ms && (
                        <span style={{ color: "var(--text-tertiary)" }}>
                          {tool.duration_ms > 1000
                            ? `${(tool.duration_ms / 1000).toFixed(1)}s`
                            : `${tool.duration_ms}ms`}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Thinking chain */}
            {item.thinkingChain && item.thinkingChain.length > 0 && (
              <div>
                <div
                  className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  Thinking chain
                </div>
                <div className="space-y-1">
                  {item.thinkingChain.map((step, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 text-[11px] leading-relaxed"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <span
                        className="text-[9px] font-bold mt-0.5 shrink-0"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {i + 1}.
                      </span>
                      <span className="italic">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* History */}
            <div>
              <div
                className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: "var(--text-tertiary)" }}
              >
                Related
              </div>
              <HistoryList item={item} allItems={allItems} />
            </div>
          </div>

          {/* ── Right sidebar: artifact navigator ── */}
          {item.artifacts.length > 1 && (
            <div
              className="w-52 shrink-0 overflow-y-auto wenmei-scroll py-4 px-3"
              style={{
                borderLeft: "1px solid var(--surface-3)",
                background: "var(--surface-0)",
              }}
            >
              <div
                className="text-[10px] font-semibold uppercase tracking-wider mb-2"
                style={{ color: "var(--text-tertiary)" }}
              >
                Artifacts · {item.artifacts.length}
              </div>
              <div className="space-y-1">
                {item.artifacts.map((artifact, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveArtifact(artifact)}
                    className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-left text-[11px] transition-colors"
                    style={{
                      background:
                        activeArtifact === artifact
                          ? "rgba(0, 134, 115, 0.1)"
                          : "transparent",
                      color:
                        activeArtifact === artifact
                          ? "var(--accent-teal)"
                          : "var(--text-secondary)",
                    }}
                  >
                    {artifact.type === "diff" && <GitCompare size={10} />}
                    {artifact.type === "file" && <FileText size={10} />}
                    {artifact.type === "code" && <Terminal size={10} />}
                    {artifact.type === "link" && <ExternalLink size={10} />}
                    <span className="truncate flex-1">{artifact.label}</span>
                    {artifact.type === "link" && (
                      <ArrowRight size={9} className="shrink-0 opacity-50" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
