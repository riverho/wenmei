import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Plus, X } from "lucide-react";
import { listen, type UnlistenFn } from "@/lib/tauri-events";
import { useAppStore, TERMINAL_TAB_MB } from "@/store/appStore";
import {
  terminalResize,
  terminalSetActive,
  terminalStart,
  terminalWrite,
  type TerminalStarted,
} from "@/lib/tauri-bridge";
import "@xterm/xterm/css/xterm.css";

interface TerminalOutputPayload {
  session_id?: string;
  data: number[];
  activity?: "active" | "idle" | "stuck";
}

const CONTEXT_RESET_ERROR = "[ERR_CONTEXT_SWITCH_REQUIRES_RESET]";

// Store-backed tab strip. Each tab is its own isolated PTY session
// (TerminalInstance renders one xterm per tab, kept mounted on switch).
function TerminalTabBar() {
  const terminalTabs = useAppStore(s => s.terminalTabs);
  const activeTerminalTabId = useAppStore(s => s.activeTerminalTabId);
  const addTerminalTab = useAppStore(s => s.addTerminalTab);
  const closeTerminalTab = useAppStore(s => s.closeTerminalTab);
  const setActiveTerminalTab = useAppStore(s => s.setActiveTerminalTab);
  const terminalTabLimit = useAppStore(s => s.terminalTabLimit);
  const terminalTabsUnlimited = useAppStore(s => s.terminalTabsUnlimited);

  const atLimit =
    !terminalTabsUnlimited && terminalTabs.length >= terminalTabLimit;
  const usedMb = terminalTabs.length * TERMINAL_TAB_MB;

  return (
    <div
      className="flex items-stretch overflow-x-auto shrink-0"
      style={{ background: "#070a0d", borderBottom: "1px solid #1b2127" }}
    >
      {terminalTabs.map(tab => {
        const active = tab.id === activeTerminalTabId;
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTerminalTab(tab.id)}
            className="group flex items-center gap-2 pl-3 pr-2 py-1.5 cursor-pointer shrink-0 transition-colors border-t-2"
            style={{
              background: active ? "#0a0d10" : "transparent",
              borderTopColor: active ? "var(--accent-teal)" : "transparent",
              color: active ? "#d7dde5" : "#7c8894",
            }}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: active ? "#5eead4" : "#2a333d" }}
            />
            <span className="text-[11px] font-mono whitespace-nowrap truncate max-w-[120px]">
              {tab.title}
            </span>
            {terminalTabs.length > 1 && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  closeTerminalTab(tab.id);
                }}
                className="flex items-center justify-center w-4 h-4 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10 shrink-0"
                style={{ color: "#7c8894" }}
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
        className="flex items-center justify-center w-8 shrink-0 transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/5"
        style={{ color: "#7c8894" }}
        title={
          atLimit
            ? `Tab limit reached (${terminalTabLimit}) — raise it in Settings`
            : "New terminal tab"
        }
      >
        <Plus size={14} />
      </button>

      <div className="flex-1" />

      <div
        className="flex items-center gap-1.5 px-3 shrink-0 text-[10px]"
        style={{ color: "#5a6570" }}
        title={
          terminalTabsUnlimited
            ? "Unlimited tabs"
            : `${usedMb} MB used by ${terminalTabs.length} tabs · limit ${terminalTabLimit}`
        }
      >
        <span>~{usedMb} MB</span>
        {!terminalTabsUnlimited && (
          <span>
            {terminalTabs.length}/{terminalTabLimit}
          </span>
        )}
      </div>
    </div>
  );
}

function resetMessage(error: unknown) {
  return String(error).replace(CONTEXT_RESET_ERROR, "").trim();
}

const XTERM_THEME = {
  background: "#0a0d10",
  foreground: "#d7dde5",
  cursor: "#5eead4",
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

/**
 * One isolated terminal session — its own xterm, its own PTY keyed by
 * `sessionId`. Output is filtered by session_id so tabs don't cross-talk.
 * Kept mounted while its tab is inactive (display:none) so the buffer and
 * running agent survive tab switches.
 */
function TerminalInstance({
  sessionId,
  active,
  onContext,
}: {
  sessionId: string;
  active: boolean;
  onContext: (ctx: TerminalStarted | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    let disposed = false;
    let unlistenOutput: UnlistenFn | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const term = new Terminal({
      cursorBlink: true,
      allowProposedApi: false,
      fontFamily:
        "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.35,
      scrollback: 5000,
      theme: XTERM_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
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
      terminalResize(sessionId, termRef.current.rows, termRef.current.cols).catch(
        () => {}
      );
    }

    async function start(forceRestart = false) {
      try {
        if (!unlistenOutput) {
          unlistenOutput = await listen<TerminalOutputPayload>(
            "terminal-output",
            event => {
              if (event.payload.session_id !== sessionId) return; // isolation
              term.write(new Uint8Array(event.payload.data));
            }
          );
        }
        const started = await terminalStart(
          sessionId,
          term.rows,
          term.cols,
          forceRestart
        );
        if (started.reused && started.snapshot.length > 0) {
          term.write(new Uint8Array(started.snapshot));
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
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Refit + focus when this tab becomes active (it was display:none).
  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => {
      fitRef.current?.fit();
      termRef.current?.focus();
      if (termRef.current) {
        terminalResize(
          sessionId,
          termRef.current.rows,
          termRef.current.cols
        ).catch(() => {});
      }
    }, 40);
    return () => window.clearTimeout(t);
  }, [active, sessionId]);

  return (
    <div
      ref={hostRef}
      className="flex-1 min-h-0 p-2"
      style={{ display: active ? "block" : "none" }}
    />
  );
}

export default function TerminalPanel() {
  const terminalTabs = useAppStore(s => s.terminalTabs);
  const activeTerminalTabId = useAppStore(s => s.activeTerminalTabId);
  const addTerminalTab = useAppStore(s => s.addTerminalTab);
  const [context, setContext] = useState<TerminalStarted | null>(null);

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
      style={{ background: "#0a0d10" }}
    >
      <TerminalTabBar />
      <div
        className="flex items-center justify-between gap-3 px-4 py-2 border-b text-xs"
        style={{
          borderColor: "var(--surface-3)",
          color: "var(--text-tertiary)",
        }}
      >
        <div className="truncate">
          <span style={{ color: "var(--accent-teal)" }}>
            Embedded Wenmei Terminal
          </span>
          {context ? (
            <span className="ml-2">{context.cwd}</span>
          ) : (
            <span className="ml-2">starting…</span>
          )}
        </div>
        {context && (
          <div className="hidden lg:block truncate">log: {context.log_file}</div>
        )}
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        {terminalTabs.map(tab => (
          <TerminalInstance
            key={tab.id}
            sessionId={tab.id}
            active={tab.id === activeTerminalTabId}
            onContext={setContext}
          />
        ))}
      </div>
    </div>
  );
}
