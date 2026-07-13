import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  FileNode,
  PiMessage,
  AppPersistedState,
  Vault,
  Sandbox,
  PlatformName,
  ChangesetEntry,
} from "@/lib/tauri-bridge";
import type { SidecarItem, SidecarItemKind } from "@/lib/sidecar-types";
import { mergeChangesetEntries } from "@/lib/review-changeset";

export type ViewMode = "edit" | "preview" | "split" | "paper" | "terminal";
export type LightboxVariant =
  "onboarding" | "settings" | "pi-chat" | "alert" | "custom" | null;

export interface TerminalTab {
  id: string;
  title: string;
  /** Sandbox this tab is bound to at creation — scopes its PTY context so a
   *  change of global focus doesn't reset it. Null for legacy/unbound tabs. */
  sandboxId: string | null;
  /** True until the user renames the tab, so a bound tab can keep tracking
   *  its sandbox's name instead of a stale default. */
  autoTitle: boolean;
  createdAt: number;
}
export type Keymap = Record<string, string>;

export const DEFAULT_KEYMAP: Keymap = {
  toggleLeftPanel: "mod+1",
  focusEditor: "mod+2",
  focusPi: "mod+3",
  editMode: "mod+e",
  previewMode: "mod+shift+p",
  splitMode: "mod+\\",
  togglePaper: "mod+p",
  toggleTerminal: "mod+`",
  focusSearch: "mod+b",
  commandPalette: "mod+k",
  newFile: "mod+n",
  newFolder: "mod+shift+n",
  toggleTheme: "mod+,",
  workspaceSearch: "mod+shift+f",
};

export interface CommentaryItem {
  id: string;
  text: string;
  ts: string;
}

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
  licenseTier: "free" | "pro";
  licenseKey: string | null;

  // Machine-level settings persisted in state.json (Settings panel)
  narrateByDefault: boolean;
  heartbeatEnabled: boolean;
  heartbeatIntervalMinutes: number;
  terminalTabLimit: number;
  terminalTabsUnlimited: boolean;
  sandboxNewWindows: boolean;
  narrationDepth: "off" | "brief" | "detailed";
  keymap: Keymap;

  // Terminal tabs (session-local; each tab is a PTY session)
  terminalTabs: TerminalTab[];
  activeTerminalTabId: string | null;

  // Pi Terminal
  piMessages: PiMessage[];
  piInput: string;
  isProcessing: boolean;

  // Narration commentary
  commentary: CommentaryItem[];

  // Unified sidecar overlay items (chat stays in piMessages)
  sidecarItems: SidecarItem[];
  sidecarLastSeen: Record<string, string>;

  // Review session
  activeReviewSession: string | null;
  changeset: ChangesetEntry[];

  // Mobile
  mobileMenuOpen: boolean;
  mobilePiOpen: boolean;

  // Lightbox
  firstRunAt: string | null;
  onboardingCompleted: boolean;
  lightboxOpen: boolean;
  lightboxVariant: LightboxVariant;
  lightboxTitle: string;
  lightboxSize: "sm" | "md" | "lg" | "xl" | "full";

  // Onboarding install results
  installResults: Record<string, "idle" | "installing" | "done" | "error">;

  // Paper mode backup
  paperPreviousMode: ViewMode;

  // Platform
  platform: PlatformName | null;

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

  // Narration commentary
  addCommentary: (item: CommentaryItem) => void;

  // Unified sidecar overlay items
  addSidecarItem: (item: SidecarItem) => void;
  markSidecarClassRead: (kinds: SidecarItemKind[]) => void;

  // Machine-level settings (persisted via save_app_state → state.json)
  setNarrateByDefault: (on: boolean) => void;
  setHeartbeatEnabled: (on: boolean) => void;
  setHeartbeatIntervalMinutes: (n: number) => void;
  setTerminalTabLimit: (n: number) => void;
  setTerminalTabsUnlimited: (on: boolean) => void;
  setSandboxNewWindows: (on: boolean) => void;
  setNarrationDepth: (depth: "off" | "brief" | "detailed") => void;
  setLicenseKey: (key: string | null) => void;
  clearCommentary: () => void;

  // Terminal tabs
  openTerminal: () => void;
  addTerminalTab: () => void;
  closeTerminalTab: (id: string) => void;
  setActiveTerminalTab: (id: string) => void;
  renameTerminalTab: (id: string, title: string) => void;

  // Review session
  setActiveReviewSession: (id: string | null) => void;
  setChangeset: (entries: ChangesetEntry[]) => void;
  mergeChangeset: (entries: ChangesetEntry[]) => void;

  setMobileMenuOpen: (open: boolean) => void;
  setMobilePiOpen: (open: boolean) => void;
  openLightbox: (
    variant: LightboxVariant,
    title: string,
    size?: "sm" | "md" | "lg" | "xl" | "full"
  ) => void;
  closeLightbox: () => void;
  setOnboardingCompleted: (completed: boolean) => void;
  setInstallResult: (
    key: string,
    status: "idle" | "installing" | "done" | "error"
  ) => void;
  setKeymapBinding: (action: string, chord: string) => void;
  enterPaperMode: () => void;
  exitPaperMode: () => void;
  togglePanel: (panel: "left" | "right") => void;
  cycleMode: () => void;
  applyPersistedState: (state: AppPersistedState) => void;
  getPersistedState: () => AppPersistedState;
  setPlatform: (platform: PlatformName | null) => void;
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
      licenseTier: "free",
      licenseKey: null,
      narrateByDefault: true,
      heartbeatEnabled: true,
      heartbeatIntervalMinutes: 30,
      terminalTabLimit: 8,
      terminalTabsUnlimited: false,
      sandboxNewWindows: true,
      narrationDepth: "brief",
      keymap: DEFAULT_KEYMAP,
      terminalTabs: [],
      activeTerminalTabId: null,
      isDirty: false,
      piMessages: [],
      piInput: "",
      isProcessing: false,
      commentary: [],
      sidecarItems: [],
      sidecarLastSeen: {},
      activeReviewSession: null,
      changeset: [],
      mobileMenuOpen: false,
      mobilePiOpen: false,
      firstRunAt: null,
      onboardingCompleted: false,
      lightboxOpen: false,
      lightboxVariant: null,
      lightboxTitle: "",
      lightboxSize: "md",
      installResults: { cli: "idle", finder: "idle", quicklook: "idle" },
      paperPreviousMode: "edit",
      platform: null,

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

      addCommentary: item =>
        set({
          commentary: [...get().commentary, item].slice(-100),
        }),
      clearCommentary: () => set({ commentary: [] }),

      addSidecarItem: item => {
        const existing = get().sidecarItems;
        if (existing.some(i => i.id === item.id)) return;
        // Newest first; cap keeps the in-memory overlay window bounded —
        // older history stays reachable through the journal.
        set({ sidecarItems: [item, ...existing].slice(0, 200) });
      },
      markSidecarClassRead: kinds =>
        set({
          sidecarItems: get().sidecarItems.map(i =>
            kinds.includes(i.kind) ? { ...i, read: true } : i
          ),
          sidecarLastSeen: {
            ...get().sidecarLastSeen,
            ...Object.fromEntries(
              kinds.map(k => [k, new Date().toISOString()])
            ),
          },
        }),

      setNarrateByDefault: on => set({ narrateByDefault: on }),
      setHeartbeatEnabled: on => set({ heartbeatEnabled: on }),
      setHeartbeatIntervalMinutes: n =>
        set({ heartbeatIntervalMinutes: Math.max(1, Math.round(n)) }),
      setTerminalTabLimit: n => set({ terminalTabLimit: n }),
      setTerminalTabsUnlimited: on => set({ terminalTabsUnlimited: on }),
      setSandboxNewWindows: on => set({ sandboxNewWindows: on }),
      setNarrationDepth: depth => set({ narrationDepth: depth }),
      setLicenseKey: key => set({ licenseKey: key }),

      openTerminal: () => {
        if (get().terminalTabs.length === 0) get().addTerminalTab();
        get().setMode("terminal");
      },
      addTerminalTab: () => {
        const {
          terminalTabs,
          terminalTabLimit,
          terminalTabsUnlimited,
          sandboxes,
          activeSandboxId,
        } = get();
        if (!terminalTabsUnlimited && terminalTabs.length >= terminalTabLimit) {
          return;
        }
        const id = `term-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const sandbox = sandboxes.find(s => s.id === activeSandboxId);
        const tab: TerminalTab = {
          id,
          // Bind the tab to whichever sandbox is focused right now; name it
          // after that sandbox so tabs read as contexts, not "zsh 1/2/3".
          title: sandbox?.name ?? `zsh ${terminalTabs.length + 1}`,
          sandboxId: activeSandboxId,
          autoTitle: true,
          createdAt: Date.now(),
        };
        set({ terminalTabs: [...terminalTabs, tab], activeTerminalTabId: id });
      },
      closeTerminalTab: id => {
        const tabs = get().terminalTabs.filter(t => t.id !== id);
        const active = get().activeTerminalTabId;
        set({
          terminalTabs: tabs,
          activeTerminalTabId:
            active === id ? (tabs[tabs.length - 1]?.id ?? null) : active,
        });
        if (tabs.length === 0 && get().mode === "terminal") {
          set({ mode: "edit", rightPanelOpen: true });
        }
      },
      setActiveTerminalTab: id => set({ activeTerminalTabId: id }),
      renameTerminalTab: (id, title) => {
        const trimmed = title.trim();
        set({
          terminalTabs: get().terminalTabs.map(t =>
            t.id === id
              ? { ...t, title: trimmed || t.title, autoTitle: false }
              : t
          ),
        });
      },

      setActiveReviewSession: id => set({ activeReviewSession: id }),
      setChangeset: entries => set({ changeset: entries }),
      mergeChangeset: entries =>
        set({ changeset: mergeChangesetEntries(get().changeset, entries) }),

      setMobileMenuOpen: open => set({ mobileMenuOpen: open }),
      setMobilePiOpen: open => set({ mobilePiOpen: open }),
      openLightbox: (variant, title, size = "md") => {
        if (variant === "onboarding") {
          set({ onboardingCompleted: true });
          return;
        }
        set({
          lightboxOpen: true,
          lightboxVariant: variant,
          lightboxTitle: title,
          lightboxSize: size,
        });
      },
      closeLightbox: () =>
        set({ lightboxOpen: false, lightboxVariant: null, lightboxTitle: "" }),
      setOnboardingCompleted: completed =>
        set({ onboardingCompleted: completed }),
      setPlatform: platform => set({ platform }),
      setInstallResult: (key, status) =>
        set(state => ({
          installResults: { ...state.installResults, [key]: status },
        })),
      setKeymapBinding: (action, chord) =>
        set(state => ({
          keymap: { ...state.keymap, [action]: chord },
        })),
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
          firstRunAt: state.first_run_at,
          onboardingCompleted: state.onboarding_completed,
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
          vaults: state.vaults ?? [],
          activeVaultId: state.active_vault_id ?? "default",
          sandboxes: state.sandboxes ?? [],
          activeSandboxId: state.active_sandbox_id ?? null,
          actionLog: state.action_log ?? [],
          openMode: state.open_mode ?? "vault",
          metadataMode: state.metadata_mode ?? "local",
          sandboxAuthStatus: state.sandbox_auth_status ?? "promoted",
          licenseTier: state.license_tier ?? "free",
          licenseKey: state.license_key ?? null,
          narrateByDefault: state.narrate_by_default ?? true,
          heartbeatEnabled: state.heartbeat_enabled ?? true,
          heartbeatIntervalMinutes: state.heartbeat_interval_minutes ?? 30,
          terminalTabLimit: state.terminal_tab_limit ?? 8,
          terminalTabsUnlimited: state.terminal_tabs_unlimited ?? false,
          sandboxNewWindows: state.sandbox_new_windows ?? true,
          narrationDepth: (state.narration_depth ?? "brief") as
            "off" | "brief" | "detailed",
          keymap: { ...DEFAULT_KEYMAP, ...(state.keymap ?? {}) },
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
        first_run_at: get().firstRunAt,
        onboarding_completed: get().onboardingCompleted,
        left_panel_open: get().leftPanelOpen,
        right_panel_open: get().rightPanelOpen,
        view_mode: get().mode === "terminal" ? "edit" : get().mode,
        theme: get().theme,
        last_active_file: get().activeFilePath,
        left_panel_width: get().leftPanelWidth,
        right_panel_width: get().rightPanelWidth,
        split_ratio: get().splitRatio,
        open_folders: get().openFolders,
        // pinned_files and recent_files are backend-owned (see Rust
        // save_app_state) — send empty placeholders; Rust ignores them.
        pinned_files: [],
        recent_files: [],
        vaults: get().vaults,
        active_vault_id: get().activeVaultId,
        sandboxes: get().sandboxes,
        active_sandbox_id: get().activeSandboxId,
        action_log: get().actionLog,
        open_mode: get().openMode,
        metadata_mode: get().metadataMode,
        sandbox_auth_status: get().sandboxAuthStatus,
        license_tier: get().licenseTier,
        license_key: get().licenseKey,
        narrate_by_default: get().narrateByDefault,
        heartbeat_enabled: get().heartbeatEnabled,
        heartbeat_interval_minutes: get().heartbeatIntervalMinutes,
        terminal_tab_limit: get().terminalTabLimit,
        terminal_tabs_unlimited: get().terminalTabsUnlimited,
        sandbox_new_windows: get().sandboxNewWindows,
        narration_depth: get().narrationDepth,
        keymap: get().keymap,
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
        keymap: state.keymap,
        sidecarLastSeen: state.sidecarLastSeen,
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
