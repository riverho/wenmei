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
import { mergeChangesetEntries } from "@/lib/review-changeset";

export type ViewMode = "edit" | "preview" | "split" | "paper" | "terminal";
export type LightboxVariant =
  "onboarding" | "settings" | "pi-chat" | "alert" | "custom" | null;

export interface CommentaryItem {
  id: string;
  text: string;
  ts: string;
}

export interface TerminalTab {
  id: string;
  title: string;
  narrate: boolean;
  createdAt: number;
}

/** Mock estimate: xterm buffer + PTY scrollback per tab. */
export const TERMINAL_TAB_MB = 9;

export interface ChildWindow {
  id: string;
  path: string;
  name: string;
  sandboxOn: boolean;
  x: number;
  y: number;
}

export type NotificationKind = "narration" | "review" | "agent" | "system";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  ts: string;
  read: boolean;
}

const SEED_NOTIFICATIONS: NotificationItem[] = [
  {
    id: "n-seed-1",
    kind: "review",
    title: "3 files changed by agent",
    body: "billing.md, notes/2026-q3.md, +1 — awaiting review.",
    ts: "2m ago",
    read: false,
  },
  {
    id: "n-seed-2",
    kind: "narration",
    title: "Risky change flagged",
    body: "The agent edited a date calculation you didn't ask about.",
    ts: "5m ago",
    read: false,
  },
  {
    id: "n-seed-3",
    kind: "agent",
    title: "Terminal 2 finished",
    body: "zsh 2 exited cleanly after the test run.",
    ts: "12m ago",
    read: true,
  },
];

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

  // Terminal tabs
  terminalTabs: TerminalTab[];
  activeTerminalTabId: string | null;
  narrateByDefault: boolean;
  terminalTabLimit: number;
  terminalTabsUnlimited: boolean;

  // Multi-window
  isChildWindow: boolean;
  sandboxNewWindows: boolean;
  childWindows: ChildWindow[];

  // Notifications
  notifications: NotificationItem[];

  // Pi Terminal
  piMessages: PiMessage[];
  piInput: string;
  isProcessing: boolean;

  // Narration commentary
  commentary: CommentaryItem[];

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
  removeVault: (id: string) => void;
  removeVaults: (ids: string[]) => void;
  addLocalVault: (name: string, path: string) => void;
  setSandboxes: (sandboxes: Sandbox[]) => void;
  setActionLog: (log: string[]) => void;
  openTerminal: () => void;
  addTerminalTab: () => void;
  closeTerminalTab: (id: string) => void;
  setActiveTerminalTab: (id: string) => void;
  setTabNarrate: (id: string, narrate: boolean) => void;
  setNarrateByDefault: (on: boolean) => void;
  setTerminalTabLimit: (n: number) => void;
  setTerminalTabsUnlimited: (on: boolean) => void;
  setIsChildWindow: (on: boolean) => void;
  setSandboxNewWindows: (on: boolean) => void;
  spawnChildWindow: (path: string, name: string) => void;
  closeChildWindow: (id: string) => void;
  addNotification: (n: Omit<NotificationItem, "id" | "ts" | "read">) => void;
  markNotificationsRead: () => void;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
  addPiMessage: (msg: PiMessage) => void;
  appendPiMessageText: (id: string, delta: string) => void;
  clearPiMessages: () => void;
  setPiInput: (input: string) => void;
  setIsProcessing: (val: boolean) => void;

  // Narration commentary
  addCommentary: (item: CommentaryItem) => void;
  clearCommentary: () => void;

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
      isDirty: false,
      terminalTabs: [],
      activeTerminalTabId: null,
      narrateByDefault: true,
      terminalTabLimit: 8,
      terminalTabsUnlimited: false,
      isChildWindow: false,
      sandboxNewWindows: true,
      childWindows: [],
      notifications: SEED_NOTIFICATIONS,
      piMessages: [],
      piInput: "",
      isProcessing: false,
      commentary: [],
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
        } else {
          // Terminal keeps the sidecar available — preserve the user's panel
          // state so narration commentary can stay open alongside the shell.
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
      // Soft detach — vaults are entries in state.json, never a physical
      // removal. The active vault can't be removed (switch first).
      removeVault: id => {
        if (id === get().activeVaultId) return;
        set({ vaults: get().vaults.filter(v => v.id !== id) });
      },
      removeVaults: ids => {
        const active = get().activeVaultId;
        set({
          vaults: get().vaults.filter(
            v => v.id === active || !ids.includes(v.id)
          ),
        });
      },
      addLocalVault: (name, path) => {
        const vault = {
          id: `vault-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          name,
          path,
          is_active: false,
        };
        set({ vaults: [...get().vaults, vault] });
      },
      setSandboxes: sandboxes =>
        set({
          sandboxes,
          activeSandboxId: sandboxes.find(s => s.is_active)?.id ?? null,
        }),
      setActionLog: actionLog => set({ actionLog }),
      openTerminal: () => {
        if (get().terminalTabs.length === 0) {
          get().addTerminalTab();
        }
        get().setMode("terminal");
      },
      addTerminalTab: () => {
        const { terminalTabs, terminalTabLimit, terminalTabsUnlimited } = get();
        if (!terminalTabsUnlimited && terminalTabs.length >= terminalTabLimit) {
          return;
        }
        const id = `term-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const tab: TerminalTab = {
          id,
          title: `zsh ${terminalTabs.length + 1}`,
          narrate: get().narrateByDefault,
          createdAt: Date.now(),
        };
        set({
          terminalTabs: [...terminalTabs, tab],
          activeTerminalTabId: id,
        });
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
      setTabNarrate: (id, narrate) =>
        set({
          terminalTabs: get().terminalTabs.map(t =>
            t.id === id ? { ...t, narrate } : t
          ),
        }),
      setNarrateByDefault: on => set({ narrateByDefault: on }),
      setTerminalTabLimit: n => set({ terminalTabLimit: n }),
      setTerminalTabsUnlimited: on => set({ terminalTabsUnlimited: on }),
      setIsChildWindow: on => set({ isChildWindow: on }),
      setSandboxNewWindows: on => set({ sandboxNewWindows: on }),
      spawnChildWindow: (path, name) => {
        const existing = get().childWindows;
        const offset = existing.length * 28;
        const win: ChildWindow = {
          id: `win-${Date.now()}`,
          path,
          name,
          sandboxOn: get().sandboxNewWindows,
          x: 120 + offset,
          y: 90 + offset,
        };
        set({ childWindows: [...existing, win] });
      },
      closeChildWindow: id =>
        set({ childWindows: get().childWindows.filter(w => w.id !== id) }),
      addNotification: n =>
        set({
          notifications: [
            {
              ...n,
              id: `n-${Date.now()}`,
              ts: "just now",
              read: false,
            },
            ...get().notifications,
          ].slice(0, 50),
        }),
      markNotificationsRead: () =>
        set({
          notifications: get().notifications.map(n => ({ ...n, read: true })),
        }),
      dismissNotification: id =>
        set({
          notifications: get().notifications.filter(n => n.id !== id),
        }),
      clearNotifications: () => set({ notifications: [] }),
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
