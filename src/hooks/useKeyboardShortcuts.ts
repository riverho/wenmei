import { useEffect } from "react";
import { DEFAULT_KEYMAP, useAppStore } from "@/store/appStore";

function matchesShortcut(e: KeyboardEvent, chord: string | undefined): boolean {
  if (!chord) return false;
  const parts = chord.toLowerCase().split("+");
  const expectedKey = parts[parts.length - 1];
  const wantsMod = parts.includes("mod");
  const wantsShift = parts.includes("shift");
  const wantsAlt = parts.includes("alt");
  const wantsCtrl = parts.includes("ctrl");
  const wantsMeta = parts.includes("meta");
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (wantsMod !== (e.metaKey || e.ctrlKey)) return false;
  if (wantsShift !== e.shiftKey) return false;
  if (wantsAlt !== e.altKey) return false;
  if (wantsCtrl && !e.ctrlKey) return false;
  if (wantsMeta && !e.metaKey) return false;
  return key.toLowerCase() === expectedKey;
}

export function useKeyboardShortcuts() {
  const {
    togglePanel,
    setMode,
    enterPaperMode,
    exitPaperMode,
    mode,
    cycleMode,
    setMobileMenuOpen,
    setMobilePiOpen,
    setPiInput,
    keymap,
  } = useAppStore();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      const keyFor = (action: keyof typeof DEFAULT_KEYMAP) =>
        keymap[action] ?? DEFAULT_KEYMAP[action];
      const shortcut = (action: keyof typeof DEFAULT_KEYMAP) =>
        matchesShortcut(e, keyFor(action));

      // Prevent default for our shortcuts
      const prevent = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      // Terminal-mode tab navigation. Gated to terminal mode so Ctrl/Cmd+1..9
      // don't clash with the panel shortcuts below; read fresh from the store
      // so this closure never goes stale on the tab list.
      if (mode === "terminal") {
        const st = useAppStore.getState();
        const tabs = st.terminalTabs;
        if (tabs.length > 0) {
          // Ctrl/Cmd+Tab — next, +Shift — previous (wraps)
          if (e.key === "Tab" && meta) {
            prevent();
            const idx = tabs.findIndex(t => t.id === st.activeTerminalTabId);
            const next = e.shiftKey
              ? (idx - 1 + tabs.length) % tabs.length
              : (idx + 1) % tabs.length;
            st.setActiveTerminalTab(tabs[next].id);
            return;
          }
          // Ctrl/Cmd+1..8 — jump to that tab; 9 — last tab
          if (meta && !e.shiftKey && /^[1-9]$/.test(e.key)) {
            prevent();
            const n = Number(e.key);
            const target = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1];
            if (target) st.setActiveTerminalTab(target.id);
            return;
          }
        }
      }

      // Cmd/Ctrl + 1 — Focus/Toggle left panel
      if (shortcut("toggleLeftPanel")) {
        prevent();
        togglePanel("left");
        return;
      }

      // Cmd/Ctrl + 2 — Focus center
      if (shortcut("focusEditor")) {
        prevent();
        // Focus editor
        const editor = document.querySelector(
          ".editor-textarea"
        ) as HTMLElement;
        editor?.focus();
        return;
      }

      // Cmd/Ctrl + 3 — Focus/Toggle right panel + focus Pi input
      if (shortcut("focusPi")) {
        prevent();
        togglePanel("right");
        setTimeout(() => {
          const piInput = document.querySelector(".pi-input") as HTMLElement;
          piInput?.focus();
        }, 100);
        return;
      }

      // Cmd/Ctrl + E — Edit mode
      if (shortcut("editMode")) {
        prevent();
        setMode("edit");
        return;
      }

      // Cmd/Ctrl + Shift + P — Preview mode
      if (shortcut("previewMode")) {
        prevent();
        setMode("preview");
        return;
      }

      // Cmd/Ctrl + \ — Split mode
      if (shortcut("splitMode")) {
        prevent();
        setMode("split");
        return;
      }

      // Cmd/Ctrl + P — Paper mode toggle
      if (shortcut("togglePaper")) {
        prevent();
        if (mode === "paper") {
          exitPaperMode();
        } else {
          enterPaperMode();
        }
        return;
      }

      // Cmd/Ctrl + ` — Toggle embedded sandbox terminal
      if (shortcut("toggleTerminal")) {
        prevent();
        setMode(mode === "terminal" ? "edit" : "terminal");
        return;
      }

      // Cmd/Ctrl + B — Search / Find
      if (shortcut("focusSearch")) {
        prevent();
        const searchInput = document.querySelector(
          ".file-search-input"
        ) as HTMLElement;
        searchInput?.focus();
        return;
      }

      // Cmd/Ctrl + K — Command palette (focus Pi input)
      if (shortcut("commandPalette")) {
        prevent();
        togglePanel("right");
        setTimeout(() => {
          const piInput = document.querySelector(".pi-input") as HTMLElement;
          piInput?.focus();
        }, 100);
        return;
      }

      // Cmd/Ctrl + N — New file
      if (shortcut("newFile")) {
        prevent();
        // Handled by FileTree component
        const newFileBtn = document.querySelector(
          ".new-file-btn"
        ) as HTMLElement;
        newFileBtn?.click();
        return;
      }

      // Cmd/Ctrl + Shift + N — New folder
      if (shortcut("newFolder")) {
        prevent();
        const newFolderBtn = document.querySelector(
          ".new-folder-btn"
        ) as HTMLElement;
        newFolderBtn?.click();
        return;
      }

      // Cmd/Ctrl + , — Toggle theme
      if (shortcut("toggleTheme")) {
        prevent();
        const themeBtn = document.querySelector(
          ".theme-toggle-btn"
        ) as HTMLElement;
        themeBtn?.click();
        return;
      }

      // Escape — Exit paper/terminal mode or close mobile drawers
      if (e.key === "Escape") {
        if (mode === "paper") {
          prevent();
          exitPaperMode();
          return;
        }
        if (mode === "terminal") {
          prevent();
          setMode("edit");
          return;
        }
        // Close mobile drawers
        setMobileMenuOpen(false);
        setMobilePiOpen(false);
      }

      // Space — scroll one screen down (edit/preview/paper)
      if (e.key === " " && !meta && !e.shiftKey && e.target === document.body) {
        e.preventDefault();
        const el = document.querySelector(".wenmei-scroll") as HTMLElement;
        if (el) {
          el.scrollBy({ top: el.clientHeight, behavior: "smooth" });
        }
        return;
      }

      // ArrowUp — scroll 10 rows up
      if (e.key === "ArrowUp" && !meta && e.target === document.body) {
        e.preventDefault();
        const el = document.querySelector(".wenmei-scroll") as HTMLElement;
        if (el) {
          const lineHeight = 24;
          el.scrollBy({ top: -lineHeight * 10, behavior: "smooth" });
        }
        return;
      }

      // ArrowDown — scroll 10 rows down
      if (e.key === "ArrowDown" && !meta && e.target === document.body) {
        e.preventDefault();
        const el = document.querySelector(".wenmei-scroll") as HTMLElement;
        if (el) {
          const lineHeight = 24;
          el.scrollBy({ top: lineHeight * 10, behavior: "smooth" });
        }
        return;
      }

      // Cmd/Ctrl + Shift + F — Workspace search in Pi
      if (shortcut("workspaceSearch")) {
        prevent();
        togglePanel("right");
        setPiInput("/find ");
        setTimeout(() => {
          const piInput = document.querySelector(".pi-input") as HTMLElement;
          piInput?.focus();
        }, 100);
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    mode,
    togglePanel,
    setMode,
    enterPaperMode,
    exitPaperMode,
    cycleMode,
    setMobileMenuOpen,
    setMobilePiOpen,
    setPiInput,
    keymap,
  ]);
}
