import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  terminalResize,
  terminalStart,
  terminalWrite,
  type TerminalStarted,
} from "@/lib/tauri-bridge";
import "@xterm/xterm/css/xterm.css";

interface TerminalOutputPayload {
  data: number[];
}

export default function TerminalPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [context, setContext] = useState<TerminalStarted | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    let disposed = false;
    let unlistenOutput: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const term = new Terminal({
      cursorBlink: true,
      allowProposedApi: false,
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
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

    const writeDisposable = term.onData((data) => {
      terminalWrite(data).catch((err) => {
        term.writeln(`\r\n[Wenmei terminal write failed: ${String(err)}]`);
      });
    });

    function resize() {
      if (!termRef.current || !fitRef.current) return;
      fitRef.current.fit();
      terminalResize(termRef.current.rows, termRef.current.cols).catch(() => {});
    }

    async function start() {
      try {
        unlistenOutput = await listen<TerminalOutputPayload>("terminal-output", (event) => {
          term.write(new Uint8Array(event.payload.data));
        });
        unlistenExit = await listen("terminal-exit", () => {
          term.writeln("\r\n[Wenmei terminal session ended]");
        });

        const started = await terminalStart(term.rows, term.cols);
        if (started.reused && started.snapshot.length > 0) {
          term.write(new Uint8Array(started.snapshot));
        }
        if (!disposed) setContext(started);

        resizeObserver = new ResizeObserver(resize);
        if (hostRef.current) resizeObserver.observe(hostRef.current);
        window.setTimeout(resize, 100);
      } catch (err) {
        const message = String(err);
        if (!disposed) setError(message);
        term.writeln(`\r\n[Wenmei terminal failed: ${message}]`);
      }
    }

    start();

    return () => {
      disposed = true;
      writeDisposable.dispose();
      resizeObserver?.disconnect();
      unlistenOutput?.();
      unlistenExit?.();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "#0a0d10" }}>
      <div
        className="flex items-center justify-between gap-3 px-4 py-2 border-b text-xs"
        style={{ borderColor: "var(--surface-3)", color: "var(--text-tertiary)" }}
      >
        <div className="truncate">
          <span style={{ color: "var(--accent-teal)" }}>Embedded Wenmei Terminal</span>
          {context ? <span className="ml-2">{context.cwd}</span> : <span className="ml-2">starting…</span>}
        </div>
        {context && <div className="hidden lg:block truncate">log: {context.log_file}</div>}
        {error && <div style={{ color: "#f87171" }}>{error}</div>}
      </div>
      <div ref={hostRef} className="flex-1 min-h-0 p-2" />
    </div>
  );
}
