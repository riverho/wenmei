import { useAppStore } from "@/store/appStore";
import {
  addVault,
  authorizeActiveWorkspace,
  getAppState,
  listFiles,
  listSandboxes,
  listVaults,
  openFolderDialog,
  promoteActiveWorkspace,
  readFile,
  setActiveVault,
} from "@/lib/tauri-bridge";
import type { FileNode } from "@/lib/tauri-bridge";
import {
  Moon,
  Sun,
  Monitor,
  Columns,
  Eye,
  PenLine,
  BookOpen,
  Terminal,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Command,
  Menu,
  Bot,
  CheckCircle2,
  Info,
} from "lucide-react";

function findFirstFile(nodes: FileNode[]): FileNode | null {
  for (const node of nodes) {
    if (node.node_type === "file") return node;
    if (node.children) {
      const child = findFirstFile(node.children);
      if (child) return child;
    }
  }
  return null;
}

export default function Header() {
  const {
    mode,
    theme,
    leftPanelOpen,
    rightPanelOpen,
    leftPanelWidth,
    rightPanelWidth,
    activeFilePath,
    activeFileName,
    vaults,
    activeVaultId,
    openMode,
    metadataMode,
    sandboxAuthStatus,
    setMode,
    setTheme,
    setActiveFile,
    setFileTree,
    setVaults,
    setSandboxes,
    applyPersistedState,
    setLeftPanelOpen,
    setRightPanelOpen,
    enterPaperMode,
    exitPaperMode,
    setMobileMenuOpen,
    setMobilePiOpen,
  } = useAppStore();

  const isPaper = mode === "paper";
  const isTerminal = mode === "terminal";
  const activeVault = vaults.find(vault => vault.id === activeVaultId);
  const agentState =
    openMode === "document"
      ? {
          label: "Agent",
          icon: Bot,
          color: "var(--accent-rose)",
          title:
            "Not in agentic scope. Authorize this folder as a registry sandbox.",
          onClick: () => handleAuthorizeWorkspace(false),
        }
      : metadataMode !== "local"
        ? {
            label: "Agent",
            icon: Bot,
            color: "var(--accent-teal)",
            title:
              "In agentic scope. Promote this sandbox to a local Wenmei vault.",
            onClick: () => handleAuthorizeWorkspace(true),
          }
        : {
            label: "Agent",
            icon: CheckCircle2,
            color: "var(--accent-teal)",
            title: "Agentic scope is active with local vault metadata.",
            onClick: undefined,
          };
  const AgentIcon = agentState.icon;

  function cycleTheme() {
    const next =
      theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(next);
  }

  const ThemeIcon =
    theme === "system" ? Monitor : theme === "dark" ? Sun : Moon;

  async function refreshVaultState(loadLast = false) {
    const [nextState, nextVaults, nextSandboxes, tree] = await Promise.all([
      getAppState(),
      listVaults(),
      listSandboxes(),
      listFiles(),
    ]);
    applyPersistedState(nextState);
    setVaults(nextVaults);
    setSandboxes(nextSandboxes);
    setFileTree(tree);
    if (loadLast && tree.length > 0) {
      const first = findFirstFile(tree);
      if (first) {
        const file = await readFile(first.path);
        setActiveFile(file.path, file.content, file.name);
      } else {
        setActiveFile(null, "", "");
      }
    } else {
      setActiveFile(null, "", "");
    }
  }

  async function handleVaultSwitch(id: string) {
    await setActiveVault(id);
    await refreshVaultState(true);
  }

  async function handleJoinVault() {
    const path = await openFolderDialog();
    if (!path) return;
    const vault = await addVault(path);
    await setActiveVault(vault.id);
    await refreshVaultState(true);
  }

  function handleOpenTerminal() {
    setMode(isTerminal ? "edit" : "terminal");
  }

  async function handleAuthorizeWorkspace(local = false) {
    try {
      if (local) {
        await promoteActiveWorkspace();
      } else {
        await authorizeActiveWorkspace("global");
      }
      await refreshVaultState(false);
      window.dispatchEvent(new CustomEvent("wenmei-workspace-authorized"));
    } catch (err) {
      window.alert(`Authorization failed: ${err}`);
    }
  }

  return (
    <header
      className="animate-header-slide flex items-center justify-between px-4 h-12 shrink-0"
      style={{
        background: "var(--surface-0)",
        borderBottom: "1px solid var(--surface-3)",
        zIndex: 50,
      }}
    >
      {/* Left section */}
      <div className="flex items-center gap-3 overflow-hidden min-w-0">
        {/* Mobile menu */}
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="md:hidden flex items-center justify-center w-8 h-8 rounded transition-colors"
          style={{ color: "var(--text-secondary)" }}
        >
          <Menu size={16} />
        </button>

        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <img
            src="/logo-icon.png"
            alt="Wenmei"
            className="w-5 h-5 opacity-80"
          />
          <span
            className="logo-glitch display-font text-lg font-normal tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            Wenmei
          </span>
        </div>

        {/* Breadcrumb / vault switcher */}
        <div className="hidden md:flex items-center gap-1.5 text-xs min-w-0">
          <select
            value={activeVaultId}
            onChange={event => handleVaultSwitch(event.target.value)}
            className="bg-transparent outline-none max-w-[140px]"
            style={{ color: "var(--text-tertiary)" }}
            title={activeVault?.path}
          >
            {vaults.map(vault => (
              <option key={vault.id} value={vault.id}>
                {vault.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleJoinVault}
            className="px-1.5 py-0.5 rounded"
            style={{
              color: "var(--accent-teal)",
              background: "var(--surface-2)",
            }}
            title="Join folder as vault"
          >
            +
          </button>
          <span style={{ color: "var(--text-tertiary)" }}>/</span>
          <span
            className="truncate max-w-[240px]"
            style={{ color: "var(--text-secondary)" }}
            title={activeVault?.path}
          >
            {activeFilePath || activeFileName || "untitled.md"}
          </span>
          <span
            className="hidden lg:inline-flex px-1.5 py-0.5 rounded uppercase tracking-wider"
            style={{
              color: "var(--text-tertiary)",
              background: "var(--surface-2)",
              fontSize: "10px",
            }}
            title={`${sandboxAuthStatus} · ${metadataMode} metadata`}
          >
            {openMode}
          </span>
        </div>
      </div>

      {/* Center section - Mode toggles */}
      {!isPaper && !isTerminal && (
        <div
          className="hidden sm:flex items-center rounded-md p-0.5 shrink-0"
          style={{ background: "var(--surface-2)" }}
        >
          {[
            { key: "edit" as const, label: "Edit", icon: PenLine },
            { key: "preview" as const, label: "Preview", icon: Eye },
            { key: "split" as const, label: "Split", icon: Columns },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all duration-200"
              style={{
                background: mode === key ? "var(--surface-1)" : "transparent",
                color:
                  mode === key
                    ? "var(--text-primary)"
                    : "var(--text-secondary)",
                boxShadow: mode === key ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}
            >
              <Icon size={13} />
              <span className="hidden lg:inline">{label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Right section */}
      <div className="flex items-center gap-0.5 shrink-0">
        {/* Mobile Pi toggle */}
        <button
          onClick={() => setMobilePiOpen(true)}
          className="md:hidden flex items-center justify-center w-8 h-8 rounded transition-colors"
          style={{ color: "var(--text-secondary)" }}
        >
          <Command size={15} />
        </button>

        {/* Agent scope status/action */}
        <button
          onClick={agentState.onClick}
          disabled={!agentState.onClick}
          className="hidden md:flex items-center justify-center gap-1.5 px-2 h-8 rounded text-xs transition-all duration-200 enabled:hover:-translate-y-0.5 disabled:cursor-default"
          style={{
            color: "var(--text-secondary)",
            background: "var(--surface-2)",
          }}
          title={agentState.title}
        >
          <AgentIcon size={13} style={{ color: agentState.color }} />
          <span>{agentState.label}</span>
        </button>
        <span
          className="hidden md:flex items-center justify-center w-6 h-8 cursor-help"
          style={{ color: "var(--text-tertiary)" }}
          title="Agent states: rose means this folder is not authorized for the agent harness. Teal means agentic scope is active through the sandbox registry. Teal check means this is a promoted local vault with local metadata."
          aria-label="Agent state meaning"
        >
          <Info size={13} />
        </span>

        {/* Open sandbox terminal */}
        <button
          onClick={handleOpenTerminal}
          className="hidden sm:flex items-center justify-center w-8 h-8 rounded transition-all duration-200 hover:-translate-y-0.5"
          style={{
            color: isTerminal ? "var(--accent-teal)" : "var(--text-secondary)",
            background: isTerminal ? "var(--surface-2)" : "transparent",
          }}
          title={
            isTerminal ? "Exit terminal mode" : "Open embedded terminal with Pi"
          }
        >
          {isTerminal ? <Minimize2 size={15} /> : <Terminal size={15} />}
        </button>

        {/* Paper mode */}
        <button
          onClick={isPaper ? exitPaperMode : enterPaperMode}
          className="hidden sm:flex items-center justify-center w-8 h-8 rounded transition-all duration-200 hover:-translate-y-0.5"
          style={{ color: "var(--text-secondary)" }}
          title={
            isPaper ? "Exit paper mode (Esc)" : "Enter paper mode (Ctrl+P)"
          }
        >
          {isPaper ? <Minimize2 size={15} /> : <BookOpen size={15} />}
        </button>

        {/* Left panel toggle */}
        <button
          onClick={() => setLeftPanelOpen(!leftPanelOpen)}
          className="hidden md:flex items-center justify-center w-8 h-8 rounded transition-all duration-200 hover:-translate-y-0.5"
          style={{ color: "var(--text-secondary)" }}
          title={`Toggle sidebar (${leftPanelWidth}px)`}
        >
          {leftPanelOpen ? (
            <PanelLeftClose size={15} />
          ) : (
            <PanelLeftOpen size={15} />
          )}
        </button>

        {/* Right panel toggle */}
        <button
          onClick={() => setRightPanelOpen(!rightPanelOpen)}
          className="hidden md:flex items-center justify-center w-8 h-8 rounded transition-all duration-200 hover:-translate-y-0.5"
          style={{ color: "var(--text-secondary)" }}
          title={`Toggle Pi panel (${rightPanelWidth}px)`}
        >
          {rightPanelOpen ? (
            <PanelRightClose size={15} />
          ) : (
            <PanelRightOpen size={15} />
          )}
        </button>

        {/* Theme toggle (cycle system/light/dark) */}
        <button
          onClick={cycleTheme}
          className="theme-toggle-btn flex items-center justify-center w-8 h-8 rounded transition-all duration-200 hover:-translate-y-0.5"
          style={{ color: "var(--text-secondary)" }}
          title={`Theme: ${theme} (Ctrl+,)`}
        >
          <ThemeIcon size={15} />
        </button>

        {/* Keyboard hint */}
        <div
          className="hidden xl:flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded text-[10px]"
          style={{
            color: "var(--text-tertiary)",
            background: "var(--surface-2)",
          }}
        >
          <span>Ctrl+1/2/3</span>
        </div>
      </div>
    </header>
  );
}
