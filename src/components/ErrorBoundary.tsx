import { Component, type ErrorInfo, type ReactNode } from "react";
import { appendJournal } from "@/lib/tauri-bridge";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort UI guard: a render crash shows a recoverable panel instead of
 * a white window, and lands in the vault journal as a system event so it
 * surfaces in the sidecar feed and diagnostics.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Wenmei UI crash:", error, info.componentStack);
    appendJournal(
      "system.ui_crash",
      "frontend",
      null,
      `UI crash: ${error.message}`,
      { stack: String(error.stack ?? "").slice(0, 2000) }
    ).catch(() => {});
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        className="flex flex-col items-center justify-center h-screen w-screen gap-3 p-8 text-center"
        style={{ background: "var(--surface-0)", color: "var(--text-primary)" }}
      >
        <h1 className="display-font text-xl">Something broke in the UI</h1>
        <p
          className="text-xs max-w-md leading-relaxed"
          style={{ color: "var(--text-secondary)" }}
        >
          Your files and agent sessions are untouched — this was a display
          error. It has been written to the journal. Reload to continue.
        </p>
        <code
          className="text-[10px] max-w-lg truncate px-3 py-1.5 rounded"
          style={{
            background: "var(--surface-2)",
            color: "var(--text-tertiary)",
          }}
        >
          {this.state.error.message}
        </code>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: "var(--accent-teal)", color: "#fff" }}
        >
          Reload Wenmei
        </button>
      </div>
    );
  }
}
