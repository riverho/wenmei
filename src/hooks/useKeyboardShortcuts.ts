import { useEffect } from "react";
import { useAppStore } from "@/store/appStore";

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
  } = useAppStore();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;

      // Prevent default for our shortcuts
      const prevent = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      // Cmd/Ctrl + 1 — Focus/Toggle left panel
      if (meta && e.key === "1") {
        prevent();
        togglePanel("left");
        return;
      }

      // Cmd/Ctrl + 2 — Focus center
      if (meta && e.key === "2") {
        prevent();
        // Focus editor
        const editor = document.querySelector(".editor-textarea") as HTMLElement;
        editor?.focus();
        return;
      }

      // Cmd/Ctrl + 3 — Focus/Toggle right panel
      if (meta && e.key === "3") {
        prevent();
        togglePanel("right");
        return;
      }

      // Cmd/Ctrl + E — Edit mode
      if (meta && e.key.toLowerCase() === "e") {
        prevent();
        setMode("edit");
        return;
      }

      // Cmd/Ctrl + Shift + P — Preview mode
      if (meta && shift && e.key.toLowerCase() === "p") {
        prevent();
        setMode("preview");
        return;
      }

      // Cmd/Ctrl + \ — Split mode
      if (meta && e.key === "\\") {
        prevent();
        setMode("split");
        return;
      }

      // Cmd/Ctrl + P — Paper mode toggle
      if (meta && !shift && e.key.toLowerCase() === "p") {
        prevent();
        if (mode === "paper") {
          exitPaperMode();
        } else {
          enterPaperMode();
        }
        return;
      }

      // Cmd/Ctrl + ` — Toggle embedded sandbox terminal
      if (meta && e.key === "`") {
        prevent();
        setMode(mode === "terminal" ? "edit" : "terminal");
        return;
      }

      // Cmd/Ctrl + B — Search / Find
      if (meta && e.key.toLowerCase() === "b") {
        prevent();
        const searchInput = document.querySelector(".file-search-input") as HTMLElement;
        searchInput?.focus();
        return;
      }

      // Cmd/Ctrl + K — Command palette (focus Pi input)
      if (meta && e.key.toLowerCase() === "k") {
        prevent();
        togglePanel("right");
        setTimeout(() => {
          const piInput = document.querySelector(".pi-input") as HTMLElement;
          piInput?.focus();
        }, 100);
        return;
      }

      // Cmd/Ctrl + N — New file
      if (meta && !shift && e.key.toLowerCase() === "n") {
        prevent();
        // Handled by FileTree component
        const newFileBtn = document.querySelector(".new-file-btn") as HTMLElement;
        newFileBtn?.click();
        return;
      }

      // Cmd/Ctrl + Shift + N — New folder
      if (meta && shift && e.key.toLowerCase() === "n") {
        prevent();
        const newFolderBtn = document.querySelector(".new-folder-btn") as HTMLElement;
        newFolderBtn?.click();
        return;
      }

      // Cmd/Ctrl + , — Toggle theme
      if (meta && e.key === ",") {
        prevent();
        const themeBtn = document.querySelector(".theme-toggle-btn") as HTMLElement;
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

      // Cmd/Ctrl + Shift + F — Workspace search in Pi
      if (meta && shift && e.key.toLowerCase() === "f") {
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
  }, [mode, togglePanel, setMode, enterPaperMode, exitPaperMode, cycleMode, setMobileMenuOpen, setMobilePiOpen, setPiInput]);
}
