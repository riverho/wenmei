import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Plus, X } from "lucide-react";
import { listen, type UnlistenFn } from "@/lib/tauri-events";
import { useAppStore, TERMINAL_TAB_MB } from "@/store/appStore";
import {
  terminalResize,
  terminalStart,
  terminalWrite,
  type TerminalStarted,
} from "@/lib/tauri-bridge";
import "@xterm/xterm/css/xterm.css";

interface TerminalOutputPayload {
  session_id?: string;
  data: number[];
  activity?: TerminalActivityStatus;
}

const CONTEXT_RESET_ERROR = "[ERR_CONTEXT_SWITCH_REQUIRES_RESET]";
const ACTIVE_OUTPUT_MS = 2500;
const STUCK_AFTER_INPUT_MS = 30000;

type TerminalActivityStatus = "active" | "idle" | "stuck";

// Store-backed tab strip. Each tab is a PTY session; the visible strip is
// real (add/close/switch), and the shared xterm renders the active tab —
// full per-tab PTY isolation is the multi-session backend depth (F3).
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

export default function TerminalPanel() {
  const { activeVaultId, activeSandboxId } = useAppStore();
  const terminalTabs = useAppStore(s => s.terminalTabs);
  const addTerminalTab = useAppStore(s => s.addTerminalTab);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const startRef = useRef<((forceRestart?: boolean) => Promise<void>) | null>(
    null
  );
  const contextRef = useRef<TerminalStarted | null>(null);
  const lastOutputAtRef = useRef(0);
  const lastInputAtRef = useRef(0);
  const [context, setContext] = useState<TerminalStarted | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<TerminalActivityStatus>("idle");
  // Seed a tab when the terminal opens so the strip is never empty.
  useEffect(() => {
    if (terminalTabs.length === 0) addTerminalTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Mirrors the backend: new sessions inherit narrate_by_default (state.json).

  useEffect(() => {
    if (!hostRef.current) return;

    let disposed = false;
    let unlistenOutput: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let activityTimer: number | null = null;

    function computeActivity(now = Date.now()): TerminalActivityStatus {
      const lastOutputAt = lastOutputAtRef.current;
      const lastInputAt = lastInputAtRef.current;
      if (
        lastInputAt > lastOutputAt &&
        now - lastInputAt > STUCK_AFTER_INPUT_MS
      ) {
        return "stuck";
      }
      if (lastOutputAt > 0 && now - lastOutputAt < ACTIVE_OUTPUT_MS) {
        return "active";
      }
      return "idle";
    }

    function refreshActivity() {
      if (!disposed) setActivity(computeActivity());
    }

    const term = new Terminal({
      cursorBlink: true,
      allowProposedApi: false,
      fontFamily:
        "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.35,
      scrollback: 5000,
      theme: {
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
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    term.focus();

    termRef.current = term;
    fitRef.current = fit;

    const writeDisposable = term.onData(data => {
      lastInputAtRef.current = Date.now();
      setActivity("active");
      terminalWrite(data).catch(err => {
        term.writeln(`\r\n[Wenmei terminal write failed: ${String(err)}]`);
      });
    });

    function resize() {
      if (!termRef.current || !fitRef.current) return;
      fitRef.current.fit();
      terminalResize(termRef.current.rows, termRef.current.cols).catch(
        () => {}
      );
    }

    async function start(forceRestart = false) {
      try {
        setError(null);
        if (!unlistenOutput) {
          unlistenOutput = await listen<TerminalOutputPayload>(
            "terminal-output",
            event => {
              lastOutputAtRef.current = Date.now();
              setActivity(event.payload.activity ?? "active");
              term.write(new Uint8Array(event.payload.data));
            }
          );
        }
        if (!unlistenExit) {
          unlistenExit = await listen("terminal-exit", () => {
            term.writeln("\r\n[Wenmei terminal session ended]");
          });
        }

        const started = await terminalStart(term.rows, term.cols, forceRestart);
        if (started.reused && started.snapshot.length > 0) {
          term.write(new Uint8Array(started.snapshot));
        }
        contextRef.current = started;
        if (!disposed) {
          setContext(started);
          refreshActivity();
        }

        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(resize);
        if (hostRef.current) resizeObserver.observe(hostRef.current);
        window.setTimeout(resize, 100);
      } catch (err) {
        if (!forceRestart && String(err).includes(CONTEXT_RESET_ERROR)) {
          const confirmed = window.confirm(
            `${resetMessage(err)}\n\nReset the running terminal and start it in the focused sandbox?`
          );
          if (confirmed && !disposed) {
            await start(true);
            return;
          }
        }
        const message = String(err);
        if (!disposed) setError(message);
        term.writeln(`\r\n[Wenmei terminal failed: ${message}]`);
      }
    }

    startRef.current = start;
    activityTimer = window.setInterval(refreshActivity, 1000);
    start();

    return () => {
      disposed = true;
      startRef.current = null;
      contextRef.current = null;
      writeDisposable.dispose();
      resizeObserver?.disconnect();
      if (activityTimer !== null) window.clearInterval(activityTimer);
      unlistenOutput?.();
      unlistenExit?.();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!contextRef.current) return;
    startRef.current?.();
  }, [activeVaultId, activeSandboxId]);

  const activityColor =
    activity === "active"
      ? "var(--accent-teal)"
      : activity === "stuck"
        ? "#f87171"
        : "var(--text-tertiary)";

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
          <div className="hidden lg:block truncate">
            log: {context.log_file}
          </div>
        )}
        <div
          className="flex items-center gap-1.5 shrink-0 text-[10px] uppercase tracking-wider"
          style={{ color: activityColor }}
          title={
            activity === "stuck"
              ? "No terminal output after recent input"
              : `Terminal ${activity}`
          }
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: activityColor }}
          />
          {activity}
        </div>
        {error && <div style={{ color: "#f87171" }}>{error}</div>}
      </div>
      <div ref={hostRef} className="flex-1 min-h-0 p-2" />
    </div>
  );
}
