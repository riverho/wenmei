import { useRef, type MouseEvent as ReactMouseEvent } from "react";
import { Shield, X, FileText } from "lucide-react";
import { useAppStore, type ChildWindow } from "@/store/appStore";

/**
 * Playground-only visualization of Wenmei's multi-window support. In the real
 * app each of these is a separate OS window spawned by the Tauri backend with
 * its own sandbox scope; here they render as draggable in-page frames so the
 * multi-window UX can be reviewed without a desktop shell.
 */
export default function ChildWindowLayer() {
  const childWindows = useAppStore(s => s.childWindows);
  if (childWindows.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[200]">
      {childWindows.map((win, i) => (
        <ChildWindowFrame key={win.id} win={win} index={i} />
      ))}
    </div>
  );
}

function ChildWindowFrame({ win, index }: { win: ChildWindow; index: number }) {
  const closeChildWindow = useAppStore(s => s.closeChildWindow);
  const frameRef = useRef<HTMLDivElement>(null);
  const posRef = useRef({ x: win.x, y: win.y });

  function startDrag(e: ReactMouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { ...posRef.current };
    const onMove = (ev: MouseEvent) => {
      const nx = origin.x + (ev.clientX - startX);
      const ny = origin.y + (ev.clientY - startY);
      posRef.current = { x: nx, y: ny };
      if (frameRef.current) {
        frameRef.current.style.left = `${nx}px`;
        frameRef.current.style.top = `${ny}px`;
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div
      ref={frameRef}
      className="pointer-events-auto absolute flex flex-col rounded-xl overflow-hidden animate-scale-in"
      style={{
        left: win.x,
        top: win.y,
        width: 440,
        height: 300,
        zIndex: 200 + index,
        background: "var(--surface-1)",
        border: "1px solid var(--surface-3)",
        boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
      }}
    >
      {/* Title bar */}
      <div
        onMouseDown={startDrag}
        className="flex items-center gap-2 px-3 h-9 shrink-0 cursor-grab active:cursor-grabbing"
        style={{
          background: "var(--surface-0)",
          borderBottom: "1px solid var(--surface-3)",
        }}
      >
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => closeChildWindow(win.id)}
            className="w-3 h-3 rounded-full flex items-center justify-center group"
            style={{ background: "#ff5f57" }}
            title="Close window"
          >
            <X
              size={8}
              className="opacity-0 group-hover:opacity-100"
              style={{ color: "#7a0b00" }}
            />
          </button>
          <span
            className="w-3 h-3 rounded-full"
            style={{ background: "#febc2e" }}
          />
          <span
            className="w-3 h-3 rounded-full"
            style={{ background: "#28c840" }}
          />
        </div>
        <div className="flex items-center gap-1.5 flex-1 justify-center min-w-0">
          <img src="/logo-icon.png" alt="" className="w-3.5 h-3.5 opacity-70" />
          <span
            className="text-[11px] truncate"
            style={{ color: "var(--text-secondary)" }}
          >
            {win.name} — Wenmei
          </span>
        </div>
        <span className="w-3.5" />
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden">
        <div className="flex items-center gap-2">
          <FileText size={14} style={{ color: "var(--text-tertiary)" }} />
          <span
            className="text-sm font-medium truncate"
            style={{ color: "var(--text-primary)" }}
          >
            {win.name}
          </span>
          {win.sandboxOn && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider ml-auto"
              style={{
                background: "rgba(0,134,115,0.1)",
                color: "var(--accent-teal)",
              }}
              title="This window opened with its own sandbox scope"
            >
              <Shield size={10} />
              Sandbox on
            </span>
          )}
        </div>
        <div
          className="text-[11px] leading-relaxed rounded-lg p-2.5"
          style={{
            color: "var(--text-tertiary)",
            background: "var(--surface-0)",
            border: "1px solid var(--surface-3)",
          }}
        >
          {win.path}
        </div>
        <div
          className="flex-1 rounded-lg"
          style={{
            background:
              "repeating-linear-gradient(180deg, var(--surface-0), var(--surface-0) 22px, transparent 22px, transparent 23px)",
            opacity: 0.5,
          }}
        />
        <p
          className="text-[10px] text-center"
          style={{ color: "var(--text-tertiary)" }}
        >
          Preview of a separate Wenmei window · each carries its own sandbox
        </p>
      </div>
    </div>
  );
}
