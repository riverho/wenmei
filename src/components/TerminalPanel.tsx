import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { Plus, X } from "lucide-react";
import { listen, type UnlistenFn } from "@/lib/tauri-events";
import {
  registerTerminalLinkProvider,
  TerminalLinkTransform,
} from "@/lib/terminal-links";
import { useAppStore } from "@/store/appStore";
import {
  terminalResize,
  terminalSetActive,
  terminalStart,
  terminalStop,
  terminalWrite,
  type TerminalActivity,
  type TerminalStarted,
} from "@/lib/tauri-bridge";
import { type StatusMap } from "@/hooks/useTerminalStatuses";
import "@xterm/xterm/css/xterm.css";

interface TerminalOutputPayload {
  session_id?: string;
  data: number[];
  activity?: TerminalActivity;
}

const CONTEXT_RESET_ERROR = "[ERR_CONTEXT_SWITCH_REQUIRES_RESET]";

/** How each live status paints its tab dot. `unknown` = no status yet. */
const STATUS_DOT: Record<
  TerminalActivity | "unknown",
  { color: string; pulse: boolean; label: string }
> = {
  active: { color: "var(--accent-teal)", pulse: false, label: "running" },
  idle: { color: "var(--text-tertiary)", pulse: false, label: "idle" },
  "needs-input": { color: "#fbbf24", pulse: true, label: "waiting for input" },
  stuck: { color: "#ef4444", pulse: true, label: "stuck" },
  unknown: { color: "var(--surface-3)", pulse: false, label: "starting…" },
};

// Store-backed tab strip. Each tab is its own isolated PTY session
// (TerminalInstance renders one xterm per tab, kept mounted on switch). The
// dot reflects the session's *live status*; the top border marks the *focused*
// tab. `statuses` is polled by TerminalPanel.
function TerminalTabBar({ statuses }: { statuses: StatusMap }) {
  const terminalTabs = useAppStore(s => s.terminalTabs);
  const activeTerminalTabId = useAppStore(s => s.activeTerminalTabId);
  const addTerminalTab = useAppStore(s => s.addTerminalTab);
  const closeTerminalTab = useAppStore(s => s.closeTerminalTab);
  const setActiveTerminalTab = useAppStore(s => s.setActiveTerminalTab);
  const renameTerminalTab = useAppStore(s => s.renameTerminalTab);
  const terminalTabLimit = useAppStore(s => s.terminalTabLimit);
  const terminalTabsUnlimited = useAppStore(s => s.terminalTabsUnlimited);
  const sandboxes = useAppStore(s => s.sandboxes);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const atLimit =
    !terminalTabsUnlimited && terminalTabs.length >= terminalTabLimit;
  const waiting = terminalTabs.filter(
    t => statuses[t.id] === "needs-input"
  ).length;

  const sandboxName = (id: string | null) =>
    id ? (sandboxes.find(s => s.id === id)?.name ?? null) : null;

  function commitRename() {
    if (editingId) renameTerminalTab(editingId, draft);
    setEditingId(null);
  }

  function handleClose(id: string) {
    closeTerminalSession(id, statuses[id] ?? "unknown", closeTerminalTab);
  }

  return (
    <div
      className="flex items-stretch overflow-x-auto shrink-0"
      style={{
        background: "var(--surface-2)",
        borderBottom: "1px solid var(--surface-3)",
      }}
    >
      {terminalTabs.map(tab => {
        const active = tab.id === activeTerminalTabId;
        const status = statuses[tab.id] ?? "unknown";
        const dot = STATUS_DOT[status];
        const sbName = sandboxName(tab.sandboxId);
        const showSandbox = sbName && sbName !== tab.title;
        const attention =
          !active && (status === "needs-input" || status === "stuck");
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTerminalTab(tab.id)}
            className="group flex items-center gap-2 pl-3 pr-2 py-1.5 cursor-pointer shrink-0 transition-colors border-t-2"
            style={{
              background: active
                ? "var(--surface-0)"
                : attention
                  ? "rgba(251,191,36,0.06)"
                  : "transparent",
              borderTopColor: active ? "var(--accent-teal)" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-secondary)",
            }}
            title={`${tab.title}${
              sbName ? ` · sandbox: ${sbName}` : " · no sandbox"
            } · ${dot.label}`}
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                dot.pulse ? "animate-pulse" : ""
              }`}
              style={{ background: dot.color }}
            />
            {editingId === tab.id ? (
              <input
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onClick={e => e.stopPropagation()}
                onBlur={commitRename}
                onKeyDown={e => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setEditingId(null);
                }}
                className="bg-transparent outline-none text-[11px] font-mono w-24"
                style={{
                  color: "var(--text-primary)",
                  borderBottom: "1px solid var(--accent-teal)",
                }}
              />
            ) : (
              <span
                className="flex items-baseline gap-1.5 min-w-0"
                onDoubleClick={e => {
                  e.stopPropagation();
                  setEditingId(tab.id);
                  setDraft(tab.title);
                }}
              >
                <span className="text-[11px] font-mono whitespace-nowrap truncate max-w-[120px]">
                  {tab.title}
                </span>
                {showSandbox && (
                  <span
                    className="hidden sm:inline text-[9px] font-mono whitespace-nowrap truncate max-w-[90px]"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {sbName}
                  </span>
                )}
              </span>
            )}
            {terminalTabs.length > 1 && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  handleClose(tab.id);
                }}
                className="flex items-center justify-center w-4 h-4 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--surface-3)] shrink-0"
                style={{ color: "var(--text-secondary)" }}
                title="Close tab"
              >
                <X size={11} />
              </button>
            )}
          </div>
        );
      })}

      <button
        onClick={() => addTerminalTab()}
        disabled={atLimit}
        className="flex items-center justify-center w-8 shrink-0 transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--surface-3)]"
        style={{ color: "var(--text-secondary)" }}
        title={
          atLimit
            ? `Tab limit reached (${terminalTabLimit}) — raise it in Settings`
            : "New terminal tab (bound to the focused sandbox)"
        }
      >
        <Plus size={14} />
      </button>

      <div className="flex-1" />

      <div
        className="flex items-center gap-2 px-3 shrink-0 text-[10px]"
        style={{ color: "var(--text-tertiary)" }}
      >
        {waiting > 0 && (
          <span
            className="flex items-center gap-1 animate-pulse"
            style={{ color: "#fbbf24" }}
            title={`${waiting} terminal${waiting > 1 ? "s" : ""} waiting for input`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: "#fbbf24" }}
            />
            {waiting} waiting
          </span>
        )}
        <span
          title={
            terminalTabsUnlimited
              ? `${terminalTabs.length} tabs · unlimited`
              : `${terminalTabs.length} of ${terminalTabLimit} tabs`
          }
        >
          {terminalTabs.length}
          {!terminalTabsUnlimited && `/${terminalTabLimit}`} tabs
        </span>
      </div>
    </div>
  );
}

function resetMessage(error: unknown) {
  return String(error).replace(CONTEXT_RESET_ERROR, "").trim();
}

// Kill the PTY on close (fixes the orphaned-session leak), and confirm first
// when the session is doing or awaiting work so a misclick can't drop an
// agent. Shared by the tab strip and the grid pane title bars.
function closeTerminalSession(
  id: string,
  status: TerminalActivity | "unknown",
  closeTerminalTab: (id: string) => void
) {
  const live = status === "active" || status === "needs-input";
  if (live) {
    const ok = window.confirm(
      status === "needs-input"
        ? "This terminal is waiting for input. Close it and end the session?"
        : "This terminal has a running session. Close it and end the session?"
    );
    if (!ok) return;
  }
  terminalStop(id).catch(() => {});
  closeTerminalTab(id);
}

// xterm needs concrete colors (the WebGL renderer can't resolve CSS vars),
// so both palettes mirror the app theme tokens in index.css: background/
// foreground track --surface-0/--text-primary, cursor tracks --accent-teal.
const XTERM_DARK = {
  background: "#0f0f0f",
  foreground: "#e8e8e8",
  cursor: "#00d9b5",
  cursorAccent: "#0f0f0f",
  selectionBackground: "#1f3a3a",
  black: "#111827",
  red: "#ef4444",
  green: "#22c55e",
  yellow: "#eab308",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#2dd4bf",
  white: "#e5e7eb",
  brightBlack: "#6b7280",
  brightRed: "#f87171",
  brightGreen: "#4ade80",
  brightYellow: "#facc15",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#f9fafb",
};

const XTERM_LIGHT = {
  background: "#f6f4f2",
  foreground: "#000000",
  cursor: "#008673",
  cursorAccent: "#f6f4f2",
  selectionBackground: "#c2e0da",
  black: "#000000",
  red: "#cd3131",
  green: "#15803d",
  yellow: "#a16207",
  blue: "#0451a5",
  magenta: "#a626a4",
  cyan: "#008673",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#e45649",
  brightGreen: "#16a34a",
  brightYellow: "#b45309",
  brightBlue: "#0969da",
  brightMagenta: "#9333ea",
  brightCyan: "#0d9488",
  brightWhite: "#a5a5a5",
};

/** Effective dark-mode flag — same resolution App.tsx applies to the root
 *  element ("system" resolves against the OS preference at render time). */
function useIsDarkTheme(): boolean {
  const theme = useAppStore(s => s.theme);
  return theme === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : theme === "dark";
}

/** Chords that navigate tabs — xterm must not swallow these or send them to
 *  the PTY; they belong to the global shortcut handler (terminal mode). */
function isTabNavChord(e: KeyboardEvent): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return false;
  if (e.key === "Tab") return true;
  return !e.shiftKey && /^[1-9]$/.test(e.key);
}

/**
 * One isolated terminal session — its own xterm, its own PTY keyed by
 * `sessionId`, scoped to the tab's own `sandboxId`. Output is filtered by
 * session_id so tabs don't cross-talk. Kept mounted while hidden
 * (display:none) so the buffer and running agent survive tab switches.
 * `visible` controls display (grid layout shows every instance at once);
 * `active` marks the focused session (keyboard focus target).
 */
function TerminalInstance({
  sessionId,
  sandboxId,
  active,
  visible,
  onContext,
}: {
  sessionId: string;
  sandboxId: string | null;
  active: boolean;
  visible: boolean;
  onContext: (ctx: TerminalStarted | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const isDark = useIsDarkTheme();

  useEffect(() => {
    if (!hostRef.current) return;
    let disposed = false;
    let unlistenOutput: UnlistenFn | null = null;
    let linkProvider: { dispose: () => void } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const linkTransform = new TerminalLinkTransform();

    const term = new Terminal({
      cursorBlink: true,
      // Unicode width providers are exposed through xterm's proposed API.
      // The terminal uses this to keep modern TUI glyphs in the right cells.
      allowProposedApi: true,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      fontSize: 14,
      fontWeight: "400",
      fontWeightBold: "600",
      letterSpacing: 0,
      lineHeight: 1,
      customGlyphs: true,
      rescaleOverlappingGlyphs: true,
      scrollback: 5000,
      theme: isDark ? XTERM_DARK : XTERM_LIGHT,
      // TUIs running inside (Claude Code, etc.) emit their own truecolor
      // output tuned for a dark background; the theme palette can't remap
      // those. Enforce a floor so pale-on-light text stays readable —
      // same mechanism and default ratio as VS Code's terminal.
      minimumContrastRatio: 4.5,
    });
    // xterm defaults to Unicode 6 width rules. Modern TUIs and native
    // terminals use newer wcwidth tables, so activate Unicode 11 before any
    // output is parsed to keep emoji, CJK, and symbols in the correct cells.
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";
    // Let tab-nav chords bubble to the window handler instead of the PTY.
    term.attachCustomKeyEventHandler(e => {
      if (e.type === "keydown" && isTabNavChord(e)) return false;
      return true;
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    linkProvider = registerTerminalLinkProvider(term);
    // Native terminal apps draw box characters as joined glyphs. xterm's
    // WebGL renderer preserves that continuity with custom glyphs, while the
    // normal DOM renderer can leave visible seams between border characters.
    // Keep the DOM renderer as a fallback for WebGL2-less webviews.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
      // The OSC-8 layer is disabled because the native-looking link treatment
      // is applied by TerminalLinkTransform and the provider above.
      const linkLayer =
        hostRef.current.querySelector<HTMLElement>(".xterm-link-layer");
      if (linkLayer) linkLayer.style.display = "none";
    } catch {
      // DOM renderer remains active when WebGL2 is unavailable.
    }
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const writeDisposable = term.onData(data => {
      terminalWrite(sessionId, data).catch(err => {
        term.writeln(`\r\n[Wenmei terminal write failed: ${String(err)}]`);
      });
    });

    function resize() {
      if (!termRef.current || !fitRef.current) return;
      fitRef.current.fit();
      terminalResize(
        sessionId,
        termRef.current.rows,
        termRef.current.cols
      ).catch(() => {});
    }

    async function start(forceRestart = false) {
      try {
        if (!unlistenOutput) {
          unlistenOutput = await listen<TerminalOutputPayload>(
            "terminal-output",
            event => {
              if (event.payload.session_id !== sessionId) return; // isolation
              term.write(
                linkTransform.transform(new Uint8Array(event.payload.data))
              );
            }
          );
        }
        const started = await terminalStart(
          sessionId,
          sandboxId,
          term.rows,
          term.cols,
          forceRestart
        );
        if (started.reused && started.snapshot.length > 0) {
          term.write(linkTransform.transform(new Uint8Array(started.snapshot)));
        }
        if (!disposed) onContext(started);
        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(resize);
        if (hostRef.current) resizeObserver.observe(hostRef.current);
        window.setTimeout(resize, 100);
      } catch (err) {
        if (!forceRestart && String(err).includes(CONTEXT_RESET_ERROR)) {
          const confirmed = window.confirm(
            `${resetMessage(err)}\n\nReset this terminal and start it in the focused sandbox?`
          );
          if (confirmed && !disposed) {
            await start(true);
            return;
          }
        }
        term.writeln(`\r\n[Wenmei terminal failed: ${String(err)}]`);
      }
    }

    start();

    return () => {
      disposed = true;
      writeDisposable.dispose();
      resizeObserver?.disconnect();
      unlistenOutput?.();
      linkProvider?.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Follow app theme switches live — assigning options.theme repaints the
  // buffer (WebGL renderer included) without restarting the session.
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = isDark ? XTERM_DARK : XTERM_LIGHT;
    }
  }, [isDark]);

  // Refit when this instance becomes visible (it was display:none), and
  // focus it when it's also the active session.
  useEffect(() => {
    if (!visible) return;
    const t = window.setTimeout(() => {
      fitRef.current?.fit();
      if (active) termRef.current?.focus();
      if (termRef.current) {
        terminalResize(
          sessionId,
          termRef.current.rows,
          termRef.current.cols
        ).catch(() => {});
      }
    }, 40);
    return () => window.clearTimeout(t);
  }, [active, visible, sessionId]);

  return (
    <div
      ref={hostRef}
      className="flex-1 min-h-0 p-2"
      style={{ display: visible ? "block" : "none" }}
    />
  );
}

export default function TerminalPanel() {
  const terminalTabs = useAppStore(s => s.terminalTabs);
  const activeTerminalTabId = useAppStore(s => s.activeTerminalTabId);
  const addTerminalTab = useAppStore(s => s.addTerminalTab);
  const closeTerminalTab = useAppStore(s => s.closeTerminalTab);
  const setActiveTerminalTab = useAppStore(s => s.setActiveTerminalTab);
  const setTerminalCwd = useAppStore(s => s.setTerminalCwd);
  const terminalLayout = useAppStore(s => s.terminalLayout);
  const terminalTabLimit = useAppStore(s => s.terminalTabLimit);
  const terminalTabsUnlimited = useAppStore(s => s.terminalTabsUnlimited);
  // Polled by useTerminalStatuses (called once from App.tsx, so it keeps
  // running regardless of which mode is active, not just while this panel
  // is mounted).
  const statuses = useAppStore(s => s.terminalTabStatuses);

  const isGrid = terminalLayout === "grid";
  const atLimit =
    !terminalTabsUnlimited && terminalTabs.length >= terminalTabLimit;
  const gridCols = Math.ceil(
    Math.sqrt(terminalTabs.length + (atLimit ? 0 : 1))
  );

  // Seed a tab when the terminal opens so the strip is never empty.
  useEffect(() => {
    if (terminalTabs.length === 0) addTerminalTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tell the backend which session is focused (approval/inject target).
  useEffect(() => {
    if (activeTerminalTabId) {
      terminalSetActive(activeTerminalTabId).catch(() => {});
    }
  }, [activeTerminalTabId]);

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: "var(--surface-0)" }}
    >
      {/* Tab strip only in tabs layout — grid panes carry their own titles */}
      {!isGrid && <TerminalTabBar statuses={statuses} />}

      {/* Body. Each tab's wrapper stays mounted in both layouts (same element
          per key), so toggling tabs/grid never remounts a TerminalInstance —
          the PTY, buffer, and any running agent survive the switch. */}
      <div
        className={
          isGrid
            ? "flex-1 min-h-0 p-2 grid gap-2 auto-rows-fr"
            : "flex-1 min-h-0 flex flex-col"
        }
        style={
          isGrid
            ? { gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }
            : undefined
        }
      >
        {terminalTabs.map(tab => {
          const focused = tab.id === activeTerminalTabId;
          const status = statuses[tab.id] ?? "unknown";
          const dot = STATUS_DOT[status];
          return (
            <div
              key={tab.id}
              onClick={
                isGrid && !focused
                  ? () => setActiveTerminalTab(tab.id)
                  : undefined
              }
              className={
                isGrid
                  ? "flex flex-col min-h-0 min-w-0 rounded-md overflow-hidden transition-colors"
                  : "flex-1 min-h-0 flex-col"
              }
              style={
                isGrid
                  ? {
                      border: `1px solid ${
                        focused ? "var(--accent-teal)" : "var(--surface-3)"
                      }`,
                      cursor: focused ? "default" : "pointer",
                    }
                  : { display: focused ? "flex" : "none" }
              }
            >
              {isGrid && (
                <div
                  className="group flex items-center gap-2 px-2 py-1 shrink-0 text-[10px] font-mono"
                  style={{
                    background: "var(--surface-2)",
                    borderBottom: "1px solid var(--surface-3)",
                    color: focused
                      ? "var(--text-primary)"
                      : "var(--text-secondary)",
                  }}
                  title={`${tab.title} · ${dot.label}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      dot.pulse ? "animate-pulse" : ""
                    }`}
                    style={{ background: dot.color }}
                  />
                  <span className="truncate">{tab.title}</span>
                  <span className="flex-1" />
                  {terminalTabs.length > 1 && (
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        closeTerminalSession(tab.id, status, closeTerminalTab);
                      }}
                      className="flex items-center justify-center w-4 h-4 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--surface-3)] shrink-0"
                      style={{ color: "var(--text-secondary)" }}
                      title="Close session"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              )}
              <TerminalInstance
                sessionId={tab.id}
                sandboxId={tab.sandboxId}
                active={focused}
                visible={isGrid || focused}
                onContext={ctx => {
                  if (ctx) setTerminalCwd(tab.id, ctx.cwd);
                }}
              />
            </div>
          );
        })}

        {/* New session tile (grid only) */}
        {isGrid && !atLimit && (
          <button
            onClick={() => addTerminalTab()}
            className="flex flex-col items-center justify-center gap-1 min-h-0 rounded-md transition-colors hover:bg-[var(--surface-1)]"
            style={{
              border: "1px dashed var(--surface-3)",
              color: "var(--text-tertiary)",
            }}
            title="New terminal session (bound to the focused sandbox)"
          >
            <Plus size={16} />
            <span className="text-[10px] font-mono">new session</span>
          </button>
        )}
      </div>
    </div>
  );
}
