/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, type MouseEvent as ReactMouseEvent } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAppStore } from "@/store/appStore";
import {
  listFiles,
  readFile,
  getAppState,
  saveAppState,
  getPinnedFiles,
  getRecentFiles,
  listVaults,
  listSandboxes,
  getActionLog,
  getInitialFile,
} from "@/lib/tauri-bridge";
import Header from "./components/Header";
import FileTree from "./components/FileTree";
import CenterPanel from "./components/CenterPanel";
import PiPanel from "./components/PiPanel";
import {
  MobileFileDrawer,
  MobilePiSheet,
} from "./components/MobileDrawers";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import "./App.css";

function AppContent() {
  const {
    activeFilePath,
    setActiveFile,
    setFileTree,
    applyPersistedState,
    getPersistedState,
    setPinnedFiles,
    setRecentFiles,
    setVaults,
    setSandboxes,
    setActionLog,
    theme,
    mode,
  } = useAppStore();

  // Keyboard shortcuts
  useKeyboardShortcuts();

  // Load persisted state and files on mount
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        // Load persisted UI state
        const persisted = await getAppState();
        if (mounted) applyPersistedState(persisted);

        // Load file tree
        const tree = await listFiles();
        if (mounted) setFileTree(tree);

        // Load pinned/recent and desktop harness state
        const [pinned, recent, vaults, sandboxes, actionLog] = await Promise.all([
          getPinnedFiles(),
          getRecentFiles(),
          listVaults(),
          listSandboxes(),
          getActionLog(),
        ]);
        if (mounted) {
          setPinnedFiles(pinned);
          setRecentFiles(recent);
          setVaults(vaults);
          setSandboxes(sandboxes);
          setActionLog(actionLog);
        }

        // CLI/Finder-launched file takes priority over last active
        const cliFile = await getInitialFile();
        const fileToOpen = cliFile ?? persisted.last_active_file;
        if (fileToOpen) {
          try {
            const file = await readFile(fileToOpen);
            if (mounted) {
              setActiveFile(file.path, file.content, file.name);
            }
          } catch (err) {
            console.warn(`Could not open startup file "${fileToOpen}":`, err);
            // If the file no longer exists, clear the active file so the user
            // doesn't see a stale state.
            if (mounted) setActiveFile(null, "", "");
          }
        }
      } catch (err) {
        console.error("Failed to init:", err);
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, []);

  // Auto-save app state on changes
  useEffect(() => {
    const timer = setTimeout(() => {
      const state = getPersistedState();
      saveAppState(state).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [
    useAppStore((s) => s.leftPanelOpen),
    useAppStore((s) => s.rightPanelOpen),
    useAppStore((s) => s.mode),
    useAppStore((s) => s.theme),
    useAppStore((s) => s.leftPanelWidth),
    useAppStore((s) => s.rightPanelWidth),
    useAppStore((s) => s.splitRatio),
    useAppStore((s) => s.openFolders),
    useAppStore((s) => s.pinnedFiles),
    useAppStore((s) => s.recentFiles),
    activeFilePath,
  ]);

  // Apply theme class
  useEffect(() => {
    const isDark =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : theme === "dark";
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  // Refresh file tree when switching back from paper mode
  useEffect(() => {
    if (mode !== "paper") {
      listFiles().then((tree) => setFileTree(tree)).catch(() => {});
    }
  }, [mode]);

  // Sandbox journal/file events refresh the file panel and @file index source.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    listen("sandbox-files-changed", () => {
      listFiles().then((tree) => setFileTree(tree)).catch(() => {});
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [setFileTree]);

  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden select-none"
      style={{ background: "var(--surface-0)" }}
    >
      <Header />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel — Desktop */}
        <LeftPanel />

        {/* Center Panel */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <CenterPanel />
        </div>

        {/* Right Panel — Desktop */}
        <RightPanel />
      </div>

      {/* Mobile Drawers */}
      <MobileFileDrawer />
      <MobilePiSheet />
    </div>
  );
}

function LeftPanel() {
  const { leftPanelOpen, leftPanelWidth, setLeftPanelWidth } = useAppStore();

  function startResize(e: ReactMouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftPanelWidth;
    const onMove = (event: MouseEvent) => {
      const next = Math.max(180, Math.min(520, startWidth + event.clientX - startX));
      setLeftPanelWidth(next);
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
      className="hidden md:flex shrink-0 overflow-hidden relative"
      style={{
        width: leftPanelOpen ? leftPanelWidth : 0,
        opacity: leftPanelOpen ? 1 : 0,
      }}
    >
      <div className="flex-1 min-w-0 overflow-hidden">{leftPanelOpen && <FileTree />}</div>
      {leftPanelOpen && (
        <div
          onMouseDown={startResize}
          className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-[var(--accent-teal)]"
          style={{ background: "transparent" }}
        />
      )}
    </div>
  );
}

function RightPanel() {
  const { rightPanelOpen, rightPanelWidth, mode } = useAppStore();
  if (mode === "terminal") return null;
  return (
    <div
      className="hidden md:flex flex-col shrink-0 transition-all duration-300 ease-out overflow-hidden"
      style={{
        width: rightPanelOpen ? rightPanelWidth : 0,
        opacity: rightPanelOpen ? 1 : 0,
      }}
    >
      {rightPanelOpen && <PiPanel />}
    </div>
  );
}

export default function App() {
  return <AppContent />;
}
