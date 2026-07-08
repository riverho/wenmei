import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen, type UnlistenFn } from "@/lib/tauri-events";
import { useAppStore } from "@/store/appStore";
import {
  terminalResize,
  terminalSetNarrationEnabled,
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

interface TerminalTab {
  sessionId: string;
  title: string;
}

function TerminalTabBar({ tabs }: { tabs: TerminalTab[] }) {
  return (
    <div
      className="flex items-center gap-1 px-3 py-1 border-b text-[11px]"
      style={{
        borderColor: "var(--surface-3)",
        background: "#080b0e",
        color: "var(--text-tertiary)",
      }}
    >
      {tabs.map(tab => (
        <button
          key={tab.sessionId}
          className="px-2 py-1 rounded border"
          style={{
            borderColor: "var(--accent-teal)",
            color: "var(--accent-teal)",
            background: "rgba(94, 234, 212, 0.08)",
          }}
          title={tab.sessionId}
        >
          {tab.title}
        </button>
      ))}
      {tabs.length === 0 && <span>Terminal</span>}
    </div>
  );
}

function resetMessage(error: unknown) {
  return String(error).replace(CONTEXT_RESET_ERROR, "").trim();
}

export default function TerminalPanel() {
  const { activeVaultId, activeSandboxId, narrateByDefault } = useAppStore();
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
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  // Mirrors the backend: new sessions inherit narrate_by_default (state.json).
  const [narrationEnabled, setNarrationEnabled] = useState(narrateByDefault);
  const [narrationOffline, setNarrationOffline] = useState(false);

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
          setTerminalTabs([
            {
              sessionId: started.session_id,
              title: started.cwd.split("/").filter(Boolean).pop() ?? "Terminal",
            },
          ]);
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

  const toggleNarration = async () => {
    const next = !narrationEnabled;
    try {
      await terminalSetNarrationEnabled(next);
      setNarrationEnabled(next);
      setNarrationOffline(false);
    } catch {
      setNarrationOffline(true);
    }
  };

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
      <TerminalTabBar tabs={terminalTabs} />
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
        <button
          onClick={toggleNarration}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] uppercase tracking-wider border transition-colors"
          style={{
            borderColor: narrationEnabled
              ? "var(--accent-teal)"
              : "var(--surface-3)",
            color: narrationEnabled
              ? "var(--accent-teal)"
              : "var(--text-tertiary)",
            background: narrationEnabled
              ? "rgba(94, 234, 212, 0.08)"
              : "transparent",
          }}
          title={
            narrationOffline
              ? "Sidecar offline"
              : narrationEnabled
                ? "Narration on"
                : "Narration off"
          }
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: narrationOffline
                ? "#f87171"
                : narrationEnabled
                  ? "var(--accent-teal)"
                  : "var(--text-tertiary)",
            }}
          />
          {narrationOffline ? "Sidecar offline" : "Narrate"}
        </button>
        {error && <div style={{ color: "#f87171" }}>{error}</div>}
      </div>
      <div ref={hostRef} className="flex-1 min-h-0 p-2" />
    </div>
  );
}
