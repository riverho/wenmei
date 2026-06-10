/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { listen, type UnlistenFn } from "@/lib/tauri-events";
import { useAppStore } from "@/store/appStore";
import {
  listFiles,
  readFile,
  getAppState,
  saveAppState,
  completeOnboarding,
  listVaults,
  listSandboxes,
  getActionLog,
  getInitialFile,
  getPlatform,
} from "@/lib/tauri-bridge";
import Header from "./components/Header";
import FileTree from "./components/FileTree";
import CenterPanel from "./components/CenterPanel";
import PiPanel from "./components/PiPanel";
import { MobileFileDrawer, MobilePiSheet } from "./components/MobileDrawers";
import Lightbox from "./components/Lightbox";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import "./App.css";

function AppContent() {
  const [initialized, setInitialized] = useState(false);
  const {
    activeFilePath,
    setActiveFile,
    setFileTree,
    applyPersistedState,
    getPersistedState,
    setVaults,
    setSandboxes,
    setActionLog,
    theme,
    mode,
    setOnboardingCompleted,
    setPlatform,
  } = useAppStore();

  // Keyboard shortcuts
  useKeyboardShortcuts();

  // Load persisted state and files on mount
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        // Detect platform first — needed before onboarding renders
        const platform = await getPlatform();
        if (mounted) setPlatform(platform);

        // Load persisted UI state
        const persisted = await getAppState();
        if (mounted) applyPersistedState(persisted);

        // Load file tree
        const tree = await listFiles();
        if (mounted) setFileTree(tree);

        // Load desktop harness state. Pinned/recent are backend-owned and
        // surfaced via FileNode.is_pinned / is_recent on the file tree —
        // no separate store mirror needed.
        const [vaults, sandboxes, actionLog] = await Promise.all([
          listVaults(),
          listSandboxes(),
          getActionLog(),
        ]);
        if (mounted) {
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

        if (mounted && !persisted.onboarding_completed) {
          setOnboardingCompleted(true);
          await completeOnboarding().catch(err => {
            console.warn("Could not persist onboarding completion:", err);
          });
        }
      } catch (err) {
        console.error("Failed to init:", err);
      } finally {
        if (mounted) setInitialized(true);
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, []);

  // Auto-save app state on changes
  useEffect(() => {
    if (!initialized) return;
    const timer = setTimeout(() => {
      const state = getPersistedState();
      saveAppState(state).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [
    useAppStore(s => s.leftPanelOpen),
    useAppStore(s => s.rightPanelOpen),
    useAppStore(s => s.mode),
    useAppStore(s => s.theme),
    useAppStore(s => s.leftPanelWidth),
    useAppStore(s => s.rightPanelWidth),
    useAppStore(s => s.splitRatio),
    useAppStore(s => s.openFolders),
    useAppStore(s => s.onboardingCompleted),
    activeFilePath,
    initialized,
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
      listFiles()
        .then(tree => setFileTree(tree))
        .catch(() => {});
    }
  }, [mode]);

  // Sandbox journal/file events refresh the file panel and @file index source.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    listen("sandbox-files-changed", () => {
      listFiles()
        .then(tree => setFileTree(tree))
        .catch(() => {});
    }).then(fn => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [setFileTree]);

  // Handle OS-level file open events (Finder double-click, open -a, etc.)
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    listen<string>("os-file-opened", event => {
      const path = event.payload;
      if (!path) return;
      readFile(path)
        .then(file => setActiveFile(file.path, file.content, file.name))
        .catch(err => console.warn(`Could not open OS file "${path}":`, err));
    }).then(fn => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [setActiveFile]);

  // Handle single-instance file open (Windows/Linux double-click while running)
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    listen<string[]>("single-instance", event => {
      const args = event.payload;
      // args[0] is the executable; file paths start at args[1]
      const path = args.find(
        arg =>
          arg.endsWith(".md") ||
          arg.endsWith(".markdown") ||
          arg.endsWith(".mdown") ||
          arg.endsWith(".mkd")
      );
      if (!path) return;
      readFile(path)
        .then(file => setActiveFile(file.path, file.content, file.name))
        .catch(err =>
          console.warn(`Could not open single-instance file "${path}":`, err)
        );
    }).then(fn => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [setActiveFile]);

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

      {/* Lightbox (onboarding, settings, etc.) */}
      <Lightbox />
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
      const next = Math.max(
        180,
        Math.min(520, startWidth + event.clientX - startX)
      );
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
      <div className="flex-1 min-w-0 overflow-hidden">
        {leftPanelOpen && <FileTree />}
      </div>
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
