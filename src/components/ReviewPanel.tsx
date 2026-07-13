import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@/lib/tauri-events";
import { useAppStore } from "@/store/appStore";
import {
  reviewSessionStart,
  reviewSessionClose,
  reviewApprove,
  reviewReject,
  reviewChangeset,
  listJournalEvents,
  readFile,
  type ChangesetEntry,
  type JournalEvent,
} from "@/lib/tauri-bridge";
import { Check, X, Play, Square, Clock, GitCompare } from "lucide-react";

function statusLabel(status: ChangesetEntry["status"]) {
  switch (status) {
    case "added":
      return "Added";
    case "modified":
      return "Modified";
    case "deleted":
      return "Deleted";
    case "baselineMissing":
      return "No baseline";
    default:
      return status;
  }
}

function statusColor(status: ChangesetEntry["status"]) {
  switch (status) {
    case "added":
      return "var(--accent-teal)";
    case "modified":
      return "var(--accent-amber)";
    case "deleted":
      return "var(--accent-rose)";
    case "baselineMissing":
      return "var(--text-tertiary)";
    default:
      return "var(--text-secondary)";
  }
}

function simpleDiff(oldText: string, newText: string) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const out: { type: "same" | "old" | "new"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i >= oldLines.length) {
      out.push({ type: "new", text: newLines[j] });
      j += 1;
    } else if (j >= newLines.length) {
      out.push({ type: "old", text: oldLines[i] });
      i += 1;
    } else if (oldLines[i] === newLines[j]) {
      out.push({ type: "same", text: oldLines[i] });
      i += 1;
      j += 1;
    } else {
      out.push({ type: "old", text: oldLines[i] });
      out.push({ type: "new", text: newLines[j] });
      i += 1;
      j += 1;
    }
  }
  return out;
}

export default function ReviewPanel() {
  const {
    activeReviewSession,
    changeset,
    setActiveReviewSession,
    setChangeset,
  } = useAppStore();

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    path: string;
    baseline: string;
    current: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [journal, setJournal] = useState<JournalEvent[]>([]);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    let mounted = true;

    reviewChangeset().then(entries => {
      if (mounted) setChangeset(entries);
    });

    listen<ChangesetEntry[]>("changeset-updated", evt => {
      setChangeset(evt.payload ?? []);
    }).then(fn => {
      unlistenRef.current = fn;
    });

    listJournalEvents(100).then(events => {
      if (mounted) setJournal(events);
    });

    return () => {
      mounted = false;
      unlistenRef.current?.();
    };
  }, [setChangeset]);

  const openPreview = async (path: string) => {
    setSelectedPath(path);
    try {
      const current = await readFile(path);
      setPreview({
        path,
        baseline: "[baseline snapshot stored in .wenmei/staging]",
        current: current.content,
      });
    } catch {
      setPreview({
        path,
        baseline: "[baseline snapshot stored in .wenmei/staging]",
        current: "",
      });
    }
  };

  const closePreview = () => {
    setSelectedPath(null);
    setPreview(null);
  };

  const startSession = async () => {
    setLoading(true);
    try {
      const id = await reviewSessionStart();
      setActiveReviewSession(id);
      setChangeset([]);
      setJournal(await listJournalEvents(100));
    } finally {
      setLoading(false);
    }
  };

  const closeSession = async (discard = false) => {
    setLoading(true);
    try {
      await reviewSessionClose(discard);
      setActiveReviewSession(null);
      setChangeset([]);
      setSelectedPath(null);
      setJournal(await listJournalEvents(100));
    } finally {
      setLoading(false);
    }
  };

  const approve = async (path: string) => {
    await reviewApprove(path);
    setChangeset(await reviewChangeset());
    setJournal(await listJournalEvents(100));
  };

  const reject = async (path: string) => {
    await reviewReject(path);
    // The file was reverted on disk. If it's the one open in the editor,
    // reload it — otherwise the editor keeps its stale buffer and re-saves it
    // on the next blur/switch, silently clobbering the revert.
    const { activeFilePath, setActiveFile } = useAppStore.getState();
    const norm = (p: string | null) => (p ?? "").replace(/^\/+/, "");
    if (activeFilePath && norm(activeFilePath) === norm(path)) {
      try {
        const f = await readFile(path);
        setActiveFile(f.path, f.content, f.name);
      } catch {
        // Rejecting an added file deletes it — clear the editor.
        setActiveFile(null);
      }
    }
    setChangeset(await reviewChangeset());
    setJournal(await listJournalEvents(100));
  };

  const diff = preview ? simpleDiff(preview.baseline, preview.current) : [];

  const sessions = journal.reduce<Record<string, JournalEvent[]>>((acc, e) => {
    const sid =
      (e.metadata as Record<string, string> | undefined)?.session_id ??
      "ungrouped";
    acc[sid] = acc[sid] ?? [];
    acc[sid].push(e);
    return acc;
  }, {});

  return (
    <div
      className="animate-right-panel flex flex-col h-full overflow-hidden select-text"
      style={{
        background: "var(--surface-glass)",
        backdropFilter: "blur(16px) saturate(140%)",
        borderLeft: "1px solid var(--surface-3)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: "1px solid var(--surface-3)" }}
      >
        <div className="flex items-center gap-1.5">
          <GitCompare size={13} style={{ color: "var(--accent-amber)" }} />
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            Review
          </span>
          {activeReviewSession && (
            <span
              className="text-[10px] truncate max-w-[120px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              {activeReviewSession}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!activeReviewSession ? (
            <button
              onClick={startSession}
              disabled={loading}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
              style={{
                background: "var(--surface-2)",
                color: "var(--text-secondary)",
              }}
            >
              <Play size={12} />
              Start
            </button>
          ) : (
            <>
              <button
                onClick={() => closeSession(false)}
                disabled={loading}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
                style={{
                  background: "var(--surface-2)",
                  color: "var(--text-secondary)",
                }}
              >
                <Square size={12} />
                Close
              </button>
              <button
                onClick={() => closeSession(true)}
                disabled={loading}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
                style={{
                  background: "var(--surface-2)",
                  color: "var(--text-tertiary)",
                }}
              >
                <X size={12} />
                Discard
              </button>
            </>
          )}
        </div>
      </div>

      {/* Changeset */}
      <div className="flex-1 overflow-y-auto wenmei-scroll px-3 py-2">
        {changeset.length === 0 && (
          <div
            className="flex flex-col items-center justify-center h-full gap-2"
            style={{ color: "var(--text-tertiary)" }}
          >
            <GitCompare size={28} className="opacity-30" />
            <p className="text-xs text-center">
              {activeReviewSession
                ? "No changes yet. Edit files or run an agent."
                : "Start a review session to capture changes."}
            </p>
          </div>
        )}

        {changeset.map(entry => (
          <div
            key={entry.path}
            className="mb-2 rounded overflow-hidden"
            style={{ background: "var(--surface-1)" }}
          >
            <button
              onClick={() =>
                selectedPath === entry.path
                  ? closePreview()
                  : openPreview(entry.path)
              }
              className="flex items-center justify-between w-full px-2 py-1.5 text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="text-[10px] font-semibold uppercase shrink-0"
                  style={{ color: statusColor(entry.status) }}
                >
                  {statusLabel(entry.status)}
                </span>
                <span
                  className="text-xs truncate"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {entry.path}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={e => {
                    e.stopPropagation();
                    approve(entry.path);
                  }}
                  className="p-1 rounded transition-colors"
                  style={{ color: "var(--accent-teal)" }}
                  title="Approve"
                >
                  <Check size={12} />
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    reject(entry.path);
                  }}
                  className="p-1 rounded transition-colors"
                  style={{ color: "var(--accent-rose)" }}
                  title="Reject / restore baseline"
                >
                  <X size={12} />
                </button>
              </div>
            </button>

            {preview?.path === entry.path && (
              <div
                className="px-2 py-2 text-[10px] terminal-font whitespace-pre-wrap"
                style={{
                  background: "var(--surface-0)",
                  color: "var(--text-tertiary)",
                }}
              >
                {diff.length <= 1 ? (
                  <div>
                    [baseline not loaded; diff requires workspace access]
                  </div>
                ) : (
                  diff.map((line, idx) => (
                    <div
                      key={idx}
                      style={{
                        color:
                          line.type === "new"
                            ? "var(--accent-teal)"
                            : line.type === "old"
                              ? "var(--accent-rose)"
                              : "var(--text-tertiary)",
                      }}
                    >
                      {line.type === "old"
                        ? "- "
                        : line.type === "new"
                          ? "+ "
                          : "  "}
                      {line.text}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Run timeline */}
      <div
        className="shrink-0 max-h-[35%] overflow-y-auto wenmei-scroll px-3 py-2"
        style={{
          borderTop: "1px solid var(--surface-3)",
          background: "var(--surface-0)",
        }}
      >
        <div
          className="flex items-center gap-1.5 mb-2 text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-tertiary)" }}
        >
          <Clock size={11} />
          Run timeline
        </div>
        {Object.entries(sessions).map(([sid, events]) => (
          <div key={sid} className="mb-2">
            <div
              className="text-[10px] font-medium mb-0.5"
              style={{ color: "var(--text-secondary)" }}
            >
              {sid}
            </div>
            <div className="space-y-0.5">
              {events.slice(0, 6).map((e, idx) => (
                <div
                  key={idx}
                  className="text-[10px] truncate"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {new Date(e.ts).toLocaleTimeString()} · {e.kind} · {e.summary}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
