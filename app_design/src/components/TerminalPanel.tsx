import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Plus, X } from "lucide-react";
import { listen, type UnlistenFn } from "@/lib/tauri-events";
import {
  useAppStore,
  TERMINAL_TAB_MB,
  type TerminalActivity,
} from "@/store/appStore";
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
  activity?: TerminalActivity;
}

const CONTEXT_RESET_ERROR = "[ERR_CONTEXT_SWITCH_REQUIRES_RESET]";
const ACTIVE_OUTPUT_MS = 2500;
const STUCK_AFTER_INPUT_MS = 30000;

function resetMessage(error: unknown) {
  return String(error).replace(CONTEXT_RESET_ERROR, "").trim();
}

// ─── Tab strip ─────────────────────────────────────────────────────────────────

function TerminalTabBar() {
  const {
    terminalTabs,
    activeTerminalTabId,
    terminalTabLimit,
    terminalTabsUnlimited,
    addTerminalTab,
    closeTerminalTab,
    setActiveTerminalTab,
  } = useAppStore();

  const atLimit =
    !terminalTabsUnlimited && terminalTabs.length >= terminalTabLimit;
  const usedMb = terminalTabs.length * TERMINAL_TAB_MB;

  const handleAddTab = () => {
    addTerminalTab();
  };

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
              minWidth: 0,
            }}
          >
            {/* Session dot — plain terminal indicator, no narrate control */}
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                background: active ? "#5eead4" : "#2a333d",
              }}
              title="Terminal session"
            />

            {/* Tab title */}
            <span className="text-[11px] font-mono whitespace-nowrap truncate max-w-[120px]">
              {tab.title}
            </span>

            {/* Close button */}
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

      {/* New tab button */}
      <button
        onClick={handleAddTab}
        disabled={atLimit}
        className="flex items-center justify-center w-8 shrink-0 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ color: "#7c8894" }}
        onMouseEnter={e => {
          if (!atLimit)
            (e.currentTarget as HTMLElement).style.background =
              "rgba(255,255,255,0.05)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
        title={
          atLimit
            ? `Tab limit reached (${terminalTabLimit}) — raise it in Settings`
            : "New terminal tab"
        }
      >
        <Plus size={14} />
      </button>

      <div className="flex-1" />

      {/* Memory indicator */}
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
          <span
            style={{
              color: usedMb > TERMINAL_TAB_MB * 5 ? "#f59e0b" : "#3a434c",
            }}
          >
            {terminalTabs.length}/{terminalTabLimit}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Grid pane mock ───────────────────────────────────────────────────────────

/**
 * Inactive grid panes show a quiet placeholder — the playground shares one
 * xterm across tabs (each tab is a separate PTY in the real app), so only
 * the focused pane hosts the live terminal.
 */
function InactivePane({ title }: { title: string }) {
  return (
    <div
      className="flex-1 min-h-0 p-2 font-mono text-[11px] leading-relaxed overflow-hidden"
      style={{ color: "#3f4a55" }}
    >
      <div>
        ~/{title.replace(/\s+/g, "-")} ${" "}
        <span
          className="inline-block w-[7px] h-[13px] align-middle"
          style={{ background: "#2a333d" }}
        />
      </div>
      <div className="mt-1 text-[10px]" style={{ color: "#2f3944" }}>
        session idle — click to focus
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function TerminalPanel() {
  const { activeVaultId, activeSandboxId } = useAppStore();
  const terminalTabs = useAppStore(s => s.terminalTabs);
  const activeTerminalTabId = useAppStore(s => s.activeTerminalTabId);
  const terminalLayout = useAppStore(s => s.terminalLayout);
  const terminalTabLimit = useAppStore(s => s.terminalTabLimit);
  const terminalTabsUnlimited = useAppStore(s => s.terminalTabsUnlimited);
  const addTerminalTab = useAppStore(s => s.addTerminalTab);
  const closeTerminalTab = useAppStore(s => s.closeTerminalTab);
  const setActiveTerminalTab = useAppStore(s => s.setActiveTerminalTab);
  const activeTab =
    terminalTabs.find(t => t.id === activeTerminalTabId) ??
    terminalTabs[0] ??
    null;

  const atLimit =
    !terminalTabsUnlimited && terminalTabs.length >= terminalTabLimit;

  // The xterm mount element is created imperatively (never React-managed) so
  // it can be reparented between the tabs slot and grid panes without a
  // remount destroying the terminal.
  const xtermElRef = useRef<HTMLDivElement | null>(null);
  const stagingRef = useRef<HTMLDivElement>(null);
  const tabsSlotRef = useRef<HTMLDivElement | null>(null);
  const gridSlotRefs = useRef(new Map<string, HTMLDivElement>());

  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const startRef = useRef<((forceRestart?: boolean) => Promise<void>) | null>(
    null
  );
  const contextRef = useRef<TerminalStarted | null>(null);
  const lastOutputAtRef = useRef(0);
  const lastInputAtRef = useRef(0);
  const [error, setError] = useState<string | null>(null);

  // Initialize xterm
  useEffect(() => {
    if (!stagingRef.current) return;

    let disposed = false;
    let unlistenOutput: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let activityTimer: number | null = null;

    const setTerminalActivity = (activity: TerminalActivity) =>
      useAppStore.getState().setTerminalActivity(activity);

    function computeActivity(now = Date.now()): TerminalActivity {
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
      if (!disposed) setTerminalActivity(computeActivity());
    }

    const el = document.createElement("div");
    el.style.width = "100%";
    el.style.height = "100%";
    xtermElRef.current = el;
    stagingRef.current.appendChild(el);

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
    term.open(el);
    term.focus();

    termRef.current = term;
    fitRef.current = fit;

    // Write input to backend
    const writeDisposable = term.onData(data => {
      lastInputAtRef.current = Date.now();
      setTerminalActivity("active");
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
              setTerminalActivity(event.payload.activity ?? "active");
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
          useAppStore.getState().setTerminalCwd(started.cwd);
          refreshActivity();
        }

        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(el);
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
        if (!disposed) {
          setError(message);
          term.writeln(`\r\n[Wenmei terminal failed: ${message}]`);
        }
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
      el.remove();
      xtermElRef.current = null;
    };
  }, []);

  // Place the live xterm element into the current slot — the tabs-mode host
  // or the active grid pane — then refit to the new dimensions.
  useEffect(() => {
    const el = xtermElRef.current;
    if (!el) return;
    const target =
      terminalLayout === "grid"
        ? (gridSlotRefs.current.get(activeTab?.id ?? "") ?? null)
        : tabsSlotRef.current;
    if (target && el.parentElement !== target) {
      target.appendChild(el);
    }
    const raf = requestAnimationFrame(() => {
      if (!fitRef.current || !termRef.current) return;
      fitRef.current.fit();
      terminalResize(termRef.current.rows, termRef.current.cols).catch(
        () => {}
      );
      termRef.current.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [terminalLayout, activeTab?.id, terminalTabs.length]);

  // Restart session when vault/sandbox changes
  useEffect(() => {
    if (!contextRef.current) return;
    startRef.current?.();
  }, [activeVaultId, activeSandboxId]);

  // Tab switch: announce in terminal. Narration is a project property now
  // (ledger-bound, Settings-managed) — the terminal neither shows nor
  // controls it, and opening a terminal never starts the Pi sidecar.
  useEffect(() => {
    if (!termRef.current || !activeTab) return;
    termRef.current.writeln(`\r\n\x1b[2m── ${activeTab.title} ──\x1b[0m\r\n`);
    // Fire only on tab switch; activeTab.title read is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTerminalTabId]);

  const gridCols = Math.ceil(
    Math.sqrt(terminalTabs.length + (atLimit ? 0 : 1))
  );

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: "#0a0d10" }}
    >
      {/* ── Tab strip (tabs layout only — grid panes carry their own titles) ── */}
      {terminalLayout === "tabs" && <TerminalTabBar />}

      {/* ── Error strip (only when the session failed) ── */}
      {error && (
        <div
          className="px-4 py-1.5 shrink-0 text-[11px] truncate"
          style={{
            background: "rgba(248,113,113,0.08)",
            borderBottom: "1px solid #1b2127",
            color: "#f87171",
          }}
          title={error}
        >
          {error}
        </div>
      )}

      {/* ── Terminal body ── */}
      {terminalLayout === "grid" ? (
        <div
          className="flex-1 min-h-0 p-2 grid gap-2 auto-rows-fr"
          style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}
        >
          {terminalTabs.map(tab => {
            const active = tab.id === activeTab?.id;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTerminalTab(tab.id)}
                className="flex flex-col min-h-0 rounded-md overflow-hidden cursor-pointer transition-colors"
                style={{
                  border: `1px solid ${active ? "var(--accent-teal)" : "#1b2127"}`,
                  background: "#0a0d10",
                }}
              >
                {/* Pane title bar */}
                <div
                  className="group flex items-center gap-2 px-2 py-1 shrink-0 text-[10px] font-mono"
                  style={{
                    background: "#070a0d",
                    borderBottom: "1px solid #1b2127",
                    color: active ? "#d7dde5" : "#7c8894",
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: active ? "#5eead4" : "#2a333d" }}
                  />
                  <span className="truncate">{tab.title}</span>
                  <span className="flex-1" />
                  {terminalTabs.length > 1 && (
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        closeTerminalTab(tab.id);
                      }}
                      className="flex items-center justify-center w-4 h-4 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10 shrink-0"
                      style={{ color: "#7c8894" }}
                      title="Close session"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>

                {/* Pane body — live xterm lands in the active pane's slot */}
                {active ? (
                  <div
                    ref={node => {
                      if (node) gridSlotRefs.current.set(tab.id, node);
                      else gridSlotRefs.current.delete(tab.id);
                    }}
                    className="flex-1 min-h-0 p-1"
                  />
                ) : (
                  <InactivePane title={tab.title} />
                )}
              </div>
            );
          })}

          {/* New session tile */}
          {!atLimit && (
            <button
              onClick={addTerminalTab}
              className="flex flex-col items-center justify-center gap-1 min-h-0 rounded-md transition-colors"
              style={{
                border: "1px dashed #1b2127",
                color: "#5a6570",
                background: "transparent",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = "#2a333d";
                (e.currentTarget as HTMLElement).style.color = "#7c8894";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = "#1b2127";
                (e.currentTarget as HTMLElement).style.color = "#5a6570";
              }}
              title="New terminal session (Ctrl+Shift+T)"
            >
              <Plus size={16} />
              <span className="text-[10px] font-mono">new session</span>
            </button>
          )}
        </div>
      ) : (
        <div ref={tabsSlotRef} className="flex-1 min-h-0 p-2" />
      )}

      {/* Hidden staging host — the xterm element mounts here before its
          first placement so init never races the layout render. */}
      <div ref={stagingRef} className="hidden" />
    </div>
  );
}
