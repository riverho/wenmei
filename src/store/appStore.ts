import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  FileNode,
  PiMessage,
  AppPersistedState,
  Vault,
  Sandbox,
} from "@/lib/tauri-bridge";

export type ViewMode = "edit" | "preview" | "split" | "paper" | "terminal";

interface AppState {
  // Layout
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  leftPanelWidth: number;
  rightPanelWidth: number;
  mode: ViewMode;
  theme: "system" | "light" | "dark";
  splitRatio: number;

  // File system
  activeFilePath: string | null;
  activeFileContent: string;
  activeFileName: string;
  fileTree: FileNode[];
  openFolders: string[];
  searchQuery: string;
  pinnedFiles: string[];
  recentFiles: string[];
  isRenaming: string | null;
  renameValue: string;

  // Editor
  isDirty: boolean;

  // Vault / sandbox harness
  vaults: Vault[];
  activeVaultId: string;
  sandboxes: Sandbox[];
  activeSandboxId: string | null;
  actionLog: string[];
  openMode: string;
  metadataMode: string;
  sandboxAuthStatus: string;

  // Pi Terminal
  piMessages: PiMessage[];
  piInput: string;
  isProcessing: boolean;

  // Mobile
  mobileMenuOpen: boolean;
  mobilePiOpen: boolean;

  // Paper mode backup
  paperPreviousMode: ViewMode;

  // Actions
  setLeftPanelOpen: (open: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  setLeftPanelWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  setMode: (mode: ViewMode) => void;
  setTheme: (theme: "system" | "light" | "dark") => void;
  setActiveFile: (path: string | null, content?: string, name?: string) => void;
  setFileTree: (tree: FileNode[]) => void;
  setActiveFileContent: (content: string) => void;
  toggleFolder: (path: string) => void;
  setSearchQuery: (query: string) => void;
  setPinnedFiles: (files: string[]) => void;
  setRecentFiles: (files: string[]) => void;
  startRename: (path: string, name: string) => void;
  setRenameValue: (val: string) => void;
  cancelRename: () => void;
  setVaults: (vaults: Vault[]) => void;
  setSandboxes: (sandboxes: Sandbox[]) => void;
  setActionLog: (log: string[]) => void;
  addPiMessage: (msg: PiMessage) => void;
  appendPiMessageText: (id: string, delta: string) => void;
  clearPiMessages: () => void;
  setPiInput: (input: string) => void;
  setIsProcessing: (val: boolean) => void;
  setMobileMenuOpen: (open: boolean) => void;
  setMobilePiOpen: (open: boolean) => void;
  enterPaperMode: () => void;
  exitPaperMode: () => void;
  togglePanel: (panel: "left" | "right") => void;
  cycleMode: () => void;
  applyPersistedState: (state: AppPersistedState) => void;
  getPersistedState: () => AppPersistedState;
}

function resolveTheme(theme: "system" | "light" | "dark"): boolean {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return theme === "dark";
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      leftPanelOpen: true,
      rightPanelOpen: true,
      leftPanelWidth: 280,
      rightPanelWidth: 360,
      mode: "edit",
      theme: "system",
      splitRatio: 0.5,
      activeFilePath: null,
      activeFileContent: "",
      activeFileName: "",
      fileTree: [],
      openFolders: ["/"],
      searchQuery: "",
      pinnedFiles: [],
      recentFiles: [],
      isRenaming: null,
      renameValue: "",
      vaults: [],
      activeVaultId: "default",
      sandboxes: [],
      activeSandboxId: null,
      actionLog: [],
      openMode: "vault",
      metadataMode: "local",
      sandboxAuthStatus: "promoted",
      isDirty: false,
      piMessages: [],
      piInput: "",
      isProcessing: false,
      mobileMenuOpen: false,
      mobilePiOpen: false,
      paperPreviousMode: "edit",

      setLeftPanelOpen: open => set({ leftPanelOpen: open }),
      setRightPanelOpen: open => set({ rightPanelOpen: open }),
      setLeftPanelWidth: w => set({ leftPanelWidth: w }),
      setRightPanelWidth: w => set({ rightPanelWidth: w }),
      setMode: mode => {
        if (mode === "paper") {
          get().enterPaperMode();
        } else if (mode === "terminal") {
          set({ mode: "terminal", rightPanelOpen: false });
        } else {
          set({ mode });
        }
      },
      setTheme: theme => {
        set({ theme });
        const isDark = resolveTheme(theme);
        if (isDark) {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
      },
      setActiveFile: (path, content = "", name = "") => {
        set({
          activeFilePath: path,
          activeFileContent: content,
          activeFileName: name,
          isDirty: false,
        });
      },
      setFileTree: tree => set({ fileTree: tree }),
      setActiveFileContent: content =>
        set({ activeFileContent: content, isDirty: true }),
      toggleFolder: path => {
        const current = get().openFolders;
        if (current.includes(path)) {
          set({ openFolders: current.filter(p => p !== path) });
        } else {
          set({ openFolders: [...current, path] });
        }
      },
      setSearchQuery: query => set({ searchQuery: query }),
      setPinnedFiles: files => set({ pinnedFiles: files }),
      setRecentFiles: files => set({ recentFiles: files }),
      startRename: (path, name) => set({ isRenaming: path, renameValue: name }),
      setRenameValue: val => set({ renameValue: val }),
      cancelRename: () => set({ isRenaming: null, renameValue: "" }),
      setVaults: vaults =>
        set({
          vaults,
          activeVaultId:
            vaults.find(v => v.is_active)?.id ?? get().activeVaultId,
        }),
      setSandboxes: sandboxes =>
        set({
          sandboxes,
          activeSandboxId: sandboxes.find(s => s.is_active)?.id ?? null,
        }),
      setActionLog: actionLog => set({ actionLog }),
      addPiMessage: msg => set({ piMessages: [...get().piMessages, msg] }),
      appendPiMessageText: (id, delta) =>
        set({
          piMessages: get().piMessages.map(msg =>
            msg.id === id ? { ...msg, text: `${msg.text}${delta}` } : msg
          ),
        }),
      clearPiMessages: () => set({ piMessages: [], piInput: "" }),
      setPiInput: input => set({ piInput: input }),
      setIsProcessing: val => set({ isProcessing: val }),
      setMobileMenuOpen: open => set({ mobileMenuOpen: open }),
      setMobilePiOpen: open => set({ mobilePiOpen: open }),
      enterPaperMode: () => {
        const prev =
          get().mode === "paper" || get().mode === "terminal"
            ? "edit"
            : get().mode;
        set({
          mode: "paper",
          paperPreviousMode: prev,
          leftPanelOpen: false,
          rightPanelOpen: false,
        });
      },
      exitPaperMode: () => {
        const prev = get().paperPreviousMode;
        set({ mode: prev, leftPanelOpen: true, rightPanelOpen: true });
      },
      togglePanel: panel => {
        if (panel === "left") {
          set({ leftPanelOpen: !get().leftPanelOpen });
        } else {
          set({ rightPanelOpen: !get().rightPanelOpen });
        }
      },
      cycleMode: () => {
        const modes: ViewMode[] = ["edit", "preview", "split"];
        const current = get().mode;
        if (current === "paper" || current === "terminal") return;
        const idx = modes.indexOf(current);
        const next = modes[(idx + 1) % modes.length];
        set({ mode: next });
      },
      applyPersistedState: state => {
        set({
          leftPanelOpen: state.left_panel_open,
          rightPanelOpen: state.right_panel_open,
          mode:
            state.view_mode === "terminal"
              ? "edit"
              : (state.view_mode as ViewMode),
          theme: state.theme as "system" | "light" | "dark",
          leftPanelWidth: state.left_panel_width,
          rightPanelWidth: state.right_panel_width,
          splitRatio: state.split_ratio,
          openFolders: state.open_folders,
          pinnedFiles: state.pinned_files,
          recentFiles: state.recent_files,
          vaults: state.vaults ?? [],
          activeVaultId: state.active_vault_id ?? "default",
          sandboxes: state.sandboxes ?? [],
          activeSandboxId: state.active_sandbox_id ?? null,
          actionLog: state.action_log ?? [],
          openMode: state.open_mode ?? "vault",
          metadataMode: state.metadata_mode ?? "local",
          sandboxAuthStatus: state.sandbox_auth_status ?? "promoted",
        });
        // Apply theme
        const isDark = resolveTheme(state.theme as "system" | "light" | "dark");
        if (isDark) {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
      },
      getPersistedState: () => ({
        left_panel_open: get().leftPanelOpen,
        right_panel_open: get().rightPanelOpen,
        view_mode: get().mode === "terminal" ? "edit" : get().mode,
        theme: get().theme,
        last_active_file: get().activeFilePath,
        left_panel_width: get().leftPanelWidth,
        right_panel_width: get().rightPanelWidth,
        split_ratio: get().splitRatio,
        open_folders: get().openFolders,
        pinned_files: get().pinnedFiles,
        recent_files: get().recentFiles,
        vaults: get().vaults,
        active_vault_id: get().activeVaultId,
        sandboxes: get().sandboxes,
        active_sandbox_id: get().activeSandboxId,
        action_log: get().actionLog,
        open_mode: get().openMode,
        metadata_mode: get().metadataMode,
        sandbox_auth_status: get().sandboxAuthStatus,
      }),
    }),
    {
      name: "wenmei-store",
      partialize: state => ({
        theme: state.theme,
        mode: state.mode,
        leftPanelOpen: state.leftPanelOpen,
        rightPanelOpen: state.rightPanelOpen,
        leftPanelWidth: state.leftPanelWidth,
        rightPanelWidth: state.rightPanelWidth,
        splitRatio: state.splitRatio,
        openFolders: state.openFolders,
        piMessages: state.piMessages.slice(-200),
      }),
    }
  )
);

// Listen for system theme changes
if (typeof window !== "undefined") {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", () => {
    const store = useAppStore.getState();
    if (store.theme === "system") {
      if (mql.matches) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  });
}
