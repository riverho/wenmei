import { useState, useRef, useCallback, useEffect } from "react";
import { useAppStore } from "@/store/appStore";
import { writeFile } from "@/lib/tauri-bridge";
import {
  renderMarkdownHTML,
  getLineNumbers,
  getReadingTime,
} from "@/lib/markdown";
import { Minimize2 } from "lucide-react";
import TerminalPanel from "./TerminalPanel";

export default function CenterPanel() {
  const {
    mode,
    activeFileContent,
    activeFilePath,
    setActiveFileContent,
    theme,
    exitPaperMode,
    splitRatio,
  } = useAppStore();

  const [paperZoom, setPaperZoom] = useState(() => {
    const saved = localStorage.getItem("wenmei-paper-zoom");
    return saved ? Math.max(50, Math.min(200, parseInt(saved, 10))) : 100;
  });

  const isDarkMode =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : theme === "dark";

  const [splitPos, setSplitPos] = useState(splitRatio * 100);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  // Auto-save to disk via Tauri
  useEffect(() => {
    if (!activeFilePath) return;
    const timer = setTimeout(() => {
      writeFile(activeFilePath, activeFileContent).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [activeFileContent, activeFilePath]);

  // Sync splitPos with store
  useEffect(() => {
    setSplitPos(splitRatio * 100);
  }, [splitRatio]);

  const handleSplitDrag = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      const rect = editorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const pct = Math.max(20, Math.min(80, (x / rect.width) * 100));
      setSplitPos(pct);
    },
    [isDragging]
  );

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const total = el.scrollHeight - el.clientHeight;
    if (total > 0) {
      setProgress(Math.round((el.scrollTop / total) * 100));
    }
  }, []);

  // Paper mode zoom via Cmd+/-
  useEffect(() => {
    if (mode !== "paper") return;
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        setPaperZoom(z => {
          const next = Math.min(200, z + 10);
          localStorage.setItem("wenmei-paper-zoom", String(next));
          return next;
        });
      } else if (e.key === "-") {
        e.preventDefault();
        setPaperZoom(z => {
          const next = Math.max(50, z - 10);
          localStorage.setItem("wenmei-paper-zoom", String(next));
          return next;
        });
      } else if (e.key === "0") {
        e.preventDefault();
        setPaperZoom(100);
        localStorage.setItem("wenmei-paper-zoom", "100");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode]);

  const isPaper = mode === "paper";

  if (mode === "terminal") {
    return <TerminalPanel />;
  }

  // Paper mode: full immersive
  if (isPaper) {
    return (
      <div
        className="relative flex flex-col h-full overflow-hidden"
        style={{
          background: isDarkMode ? "#0A0A0A" : "#FDFBF7",
        }}
      >
        {/* Progress bar */}
        <div
          className="absolute top-0 left-0 h-0.5 z-10 transition-all duration-300"
          style={{
            width: `${progress}%`,
            background: "var(--accent-teal)",
          }}
        />

        {/* Exit button */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
          <button
            onClick={exitPaperMode}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 hover:scale-105"
            style={{
              background: "var(--surface-glass)",
              backdropFilter: "blur(12px)",
              color: "var(--text-secondary)",
              border: "1px solid var(--surface-3)",
            }}
          >
            <Minimize2 size={12} />
            Exit paper mode
          </button>
        </div>

        {/* Reading time */}
        <div
          className="absolute top-4 right-6 text-xs"
          style={{ color: "var(--text-tertiary)" }}
        >
          {getReadingTime(activeFileContent)}
        </div>

        {/* Zoom indicator */}
        {paperZoom !== 100 && (
          <div
            className="absolute bottom-6 right-6 text-[10px] px-2 py-1 rounded-full z-10 select-none"
            style={{
              background: "var(--surface-glass)",
              backdropFilter: "blur(12px)",
              color: "var(--text-tertiary)",
              border: "1px solid var(--surface-3)",
            }}
          >
            {paperZoom}%
          </div>
        )}

        {/* Document */}
        <div
          className="flex-1 overflow-y-auto wenmei-scroll py-16 px-8"
          onScroll={handleScroll}
        >
          <div className="mx-auto" style={{ width: "70%", maxWidth: "70%" }}>
            <div
              className="prose-paper"
              style={{ fontSize: `${paperZoom}%` }}
              dangerouslySetInnerHTML={{
                __html: renderMarkdownHTML(activeFileContent),
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  const renderEditor = () => (
    <div className="flex h-full overflow-hidden">
      {/* Line numbers */}
      <div
        className="shrink-0 py-10 px-3 text-right select-none overflow-hidden"
        style={{
          background: "var(--surface-1)",
          color: "var(--text-tertiary)",
          fontSize: "12px",
          lineHeight: "24px",
          fontFamily: "'JetBrains Mono', monospace",
          minWidth: "44px",
        }}
      >
        <pre className="m-0 p-0 bg-transparent">
          {getLineNumbers(activeFileContent)}
        </pre>
      </div>
      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={activeFileContent}
        onChange={e => setActiveFileContent(e.target.value)}
        className="editor-textarea flex-1 resize-none outline-none py-10 px-4 editor-font wenmei-scroll"
        style={{
          background: "var(--surface-1)",
          color: "var(--text-primary)",
          fontSize: "15px",
          lineHeight: "24px",
          border: "none",
          caretColor: "var(--accent-teal)",
        }}
        spellCheck={false}
      />
    </div>
  );

  const renderPreview = () => (
    <div
      className="h-full overflow-y-auto wenmei-scroll py-10 px-10 md:px-16"
      style={{ background: "var(--surface-1)" }}
    >
      <div
        className="max-w-none"
        dangerouslySetInnerHTML={{
          __html: renderMarkdownHTML(activeFileContent),
        }}
      />
    </div>
  );

  const renderSplit = () => (
    <div
      ref={editorRef}
      className="flex h-full overflow-hidden"
      onMouseMove={handleSplitDrag}
      onMouseUp={() => setIsDragging(false)}
      onMouseLeave={() => setIsDragging(false)}
    >
      {/* Editor side */}
      <div
        className="flex overflow-hidden"
        style={{ flex: `0 0 ${splitPos}%` }}
      >
        <div
          className="shrink-0 py-10 px-3 text-right select-none overflow-hidden"
          style={{
            background: "var(--surface-1)",
            color: "var(--text-tertiary)",
            fontSize: "12px",
            lineHeight: "24px",
            fontFamily: "'JetBrains Mono', monospace",
            minWidth: "44px",
          }}
        >
          <pre className="m-0 p-0 bg-transparent">
            {getLineNumbers(activeFileContent)}
          </pre>
        </div>
        <textarea
          value={activeFileContent}
          onChange={e => setActiveFileContent(e.target.value)}
          className="flex-1 resize-none outline-none py-10 px-4 editor-font wenmei-scroll"
          style={{
            background: "var(--surface-1)",
            color: "var(--text-primary)",
            fontSize: "15px",
            lineHeight: "24px",
            border: "none",
            caretColor: "var(--accent-teal)",
          }}
          spellCheck={false}
        />
      </div>

      {/* Divider */}
      <div
        className="shrink-0 cursor-col-resize transition-colors duration-150 relative flex items-center justify-center"
        style={{
          width: isDragging ? "6px" : "4px",
          background: isDragging ? "var(--accent-teal)" : "var(--surface-3)",
        }}
        onMouseDown={() => setIsDragging(true)}
      >
        <div
          className="rounded-full"
          style={{
            width: isDragging ? "14px" : "10px",
            height: isDragging ? "14px" : "10px",
            background: isDragging ? "var(--accent-teal)" : "var(--surface-3)",
            transition: "all 0.15s",
          }}
        />
      </div>

      {/* Preview side */}
      <div
        className="flex-1 overflow-y-auto wenmei-scroll py-10 px-8"
        style={{ background: "var(--surface-1)" }}
      >
        <div
          dangerouslySetInnerHTML={{
            __html: renderMarkdownHTML(activeFileContent),
          }}
        />
      </div>
    </div>
  );

  return (
    <div
      className="animate-paper-reveal flex flex-col h-full overflow-hidden"
      style={{ background: "var(--surface-1)" }}
    >
      {mode === "edit" && renderEditor()}
      {mode === "preview" && renderPreview()}
      {mode === "split" && renderSplit()}
    </div>
  );
}
