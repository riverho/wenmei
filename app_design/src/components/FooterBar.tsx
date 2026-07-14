import { useEffect, useRef, useState } from "react";
import { Check, Copy, FolderOpen, SquareTerminal } from "lucide-react";
import { useAppStore } from "@/store/appStore";

function joinPath(root: string | undefined, rel: string | null): string {
  const base = (root ?? "").replace(/[\\/]+$/, "");
  if (!rel) return base || "—";
  const tail = rel.replace(/^[\\/]+/, "");
  return base ? `${base}/${tail}` : `/${tail}`;
}

function countWords(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

/**
 * Footer toolbar — one quiet line of ground truth at the bottom of the app.
 * Starts deliberately sparse: full path of where you are (the vault-relative
 * ambiguity in the header breadcrumb resolved), plus save state, word count,
 * and terminal session health. More can earn its way in later.
 */
export default function FooterBar() {
  const mode = useAppStore(s => s.mode);
  const vaults = useAppStore(s => s.vaults);
  const activeVaultId = useAppStore(s => s.activeVaultId);
  const activeFilePath = useAppStore(s => s.activeFilePath);
  const activeFileContent = useAppStore(s => s.activeFileContent);
  const isDirty = useAppStore(s => s.isDirty);
  const terminalTabs = useAppStore(s => s.terminalTabs);
  const terminalActivity = useAppStore(s => s.terminalActivity);
  const terminalCwd = useAppStore(s => s.terminalCwd);

  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, []);

  if (mode === "paper") return null;

  const isTerminal = mode === "terminal";
  const vault = vaults.find(v => v.id === activeVaultId);
  const fullPath =
    isTerminal && terminalCwd
      ? terminalCwd
      : joinPath(vault?.path, activeFilePath);

  const hasFile = !isTerminal && activeFilePath !== null;
  const wordCount = hasFile ? countWords(activeFileContent) : 0;

  const activityColor =
    terminalActivity === "active"
      ? "var(--accent-teal)"
      : terminalActivity === "stuck"
        ? "#f87171"
        : "var(--text-tertiary)";

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(fullPath);
      setCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable (permissions) — the tooltip still shows the path.
    }
  }

  return (
    <footer
      className="hidden sm:flex items-center gap-4 px-3 h-6 shrink-0 text-[11px]"
      style={{
        background: "var(--surface-0)",
        borderTop: "1px solid var(--surface-3)",
        color: "var(--text-tertiary)",
      }}
    >
      {/* Full path — click to copy */}
      <button
        onClick={copyPath}
        className="group flex items-center gap-1.5 min-w-0 transition-colors hover:text-[var(--text-secondary)]"
        style={{ color: "inherit" }}
        title={copied ? "Copied" : `${fullPath} — click to copy`}
      >
        <FolderOpen size={11} className="shrink-0" />
        <span className="font-mono truncate" style={{ fontSize: "10.5px" }}>
          {fullPath}
        </span>
        {copied ? (
          <Check
            size={10}
            className="shrink-0"
            style={{ color: "var(--accent-teal)" }}
          />
        ) : (
          <Copy
            size={10}
            className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity"
          />
        )}
      </button>

      <div className="flex-1" />

      {/* Word count — editor modes only */}
      {hasFile && (
        <span className="shrink-0 tabular-nums">{wordCount} words</span>
      )}

      {/* Terminal sessions + activity — whenever sessions exist */}
      {terminalTabs.length > 0 && (
        <span
          className="flex items-center gap-1.5 shrink-0"
          title={`Terminal ${terminalActivity}`}
        >
          <SquareTerminal size={11} />
          <span className="tabular-nums">
            {terminalTabs.length}{" "}
            {terminalTabs.length === 1 ? "session" : "sessions"}
          </span>
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: activityColor }}
          />
        </span>
      )}

      {/* Save state — only when a file is open */}
      {hasFile && (
        <span
          className="flex items-center gap-1.5 shrink-0"
          style={{ color: isDirty ? "#d97706" : "inherit" }}
          title={isDirty ? "Unsaved changes" : "All changes saved"}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: isDirty ? "#d97706" : "var(--accent-teal)",
            }}
          />
          {isDirty ? "Unsaved" : "Saved"}
        </span>
      )}
    </footer>
  );
}
