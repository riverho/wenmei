// ─── Mock Bridge Implementations ───
// Replaces all tauri-bridge.ts functions when running outside Tauri (npm run dev).

import type {
  FileNode,
  FileContent,
  SearchResult,
  Vault,
  Sandbox,
  AppPersistedState,
  CliStatus,
  AuthorizedSandbox,
  SandboxRegistry,
  JournalEvent,
  TerminalStarted,
  PiPanelStarted,
  PiMessage,
} from "@/lib/tauri-bridge";

import {
  mockFileTree,
  mockFileContents,
  mockAppState,
  mockVaults,
  mockSandboxes,
  mockSandboxRegistry,
  mockJournalEvents,
  mockSearchResults,
  mockTerminalStart,
  mockPiPanelStart,
  findNode,
  findParentPath,
  removeNode,
  addChild,
} from "./mock-data";

function delay(ms = 50): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── File Operations ───

export async function listFiles(): Promise<FileNode[]> {
  await delay(30);
  return JSON.parse(JSON.stringify(mockFileTree));
}

export async function readFile(path: string): Promise<FileContent> {
  await delay(20);
  const node = findNode(mockFileTree, path);
  if (!node || node.node_type !== "file") {
    throw new Error(`File not found: ${path}`);
  }
  const content = mockFileContents.get(path) ?? "// No content for this file.\n";
  return { path, content, name: node.name };
}

export async function writeFile(path: string, content: string): Promise<void> {
  await delay(20);
  mockFileContents.set(path, content);
}

export async function createFile(
  parentPath: string,
  name: string
): Promise<string> {
  await delay(30);
  const parent = findNode(mockFileTree, parentPath);
  if (!parent || parent.node_type !== "folder") {
    throw new Error(`Parent folder not found: ${parentPath}`);
  }
  const path = parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;
  if (findNode(mockFileTree, path)) {
    throw new Error(`File already exists: ${path}`);
  }
  const child: FileNode = {
    id: path,
    name,
    path,
    node_type: "file",
    is_pinned: false,
    is_recent: false,
    modified_at: new Date().toISOString(),
  };
  addChild(mockFileTree, parentPath, child);
  mockFileContents.set(path, "");
  return path;
}

export async function createFolder(
  parentPath: string,
  name: string
): Promise<string> {
  await delay(30);
  const parent = findNode(mockFileTree, parentPath);
  if (!parent || parent.node_type !== "folder") {
    throw new Error(`Parent folder not found: ${parentPath}`);
  }
  const path = parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;
  if (findNode(mockFileTree, path)) {
    throw new Error(`Folder already exists: ${path}`);
  }
  const child: FileNode = {
    id: path,
    name,
    path,
    node_type: "folder",
    children: [],
    is_pinned: false,
    is_recent: false,
    modified_at: new Date().toISOString(),
  };
  addChild(mockFileTree, parentPath, child);
  return path;
}

export async function renameFile(
  oldPath: string,
  newName: string
): Promise<string> {
  await delay(30);
  const node = findNode(mockFileTree, oldPath);
  if (!node) throw new Error(`File not found: ${oldPath}`);

  const parentPath = findParentPath(oldPath);
  const newPath = parentPath === "/" ? `/${newName}` : `${parentPath}/${newName}`;

  if (oldPath !== newPath && findNode(mockFileTree, newPath)) {
    throw new Error(`Name already exists: ${newName}`);
  }

  // Update node
  node.name = newName;
  node.path = newPath;
  node.id = newPath;

  // Update content key
  const content = mockFileContents.get(oldPath);
  if (content !== undefined) {
    mockFileContents.delete(oldPath);
    mockFileContents.set(newPath, content);
  }

  // Recursively update children if folder
  function rebase(nodes: FileNode[], oldPrefix: string, newPrefix: string) {
    for (const n of nodes) {
      if (n.path.startsWith(oldPrefix)) {
        const prevPath = n.path;
        n.path = prevPath.replace(oldPrefix, newPrefix);
        n.id = n.path;
        const c = mockFileContents.get(prevPath);
        if (c !== undefined) {
          mockFileContents.delete(prevPath);
          mockFileContents.set(n.path, c);
        }
      }
      if (n.children) rebase(n.children, oldPrefix, newPrefix);
    }
  }

  if (node.children) {
    rebase([node], oldPath, newPath);
  }

  return newPath;
}

export async function deleteFile(path: string): Promise<void> {
  await delay(30);
  const node = findNode(mockFileTree, path);
  if (!node) throw new Error(`File not found: ${path}`);
  removeNode(mockFileTree, path);
  mockFileContents.delete(path);
  if (node.children) {
    function collectPaths(nodes: FileNode[], out: string[]) {
      for (const n of nodes) {
        out.push(n.path);
        if (n.children) collectPaths(n.children, out);
      }
    }
    const childPaths: string[] = [];
    collectPaths(node.children, childPaths);
    for (const p of childPaths) mockFileContents.delete(p);
  }
}

export async function moveFile(
  source: string,
  targetFolder: string
): Promise<string> {
  await delay(30);
  const node = findNode(mockFileTree, source);
  if (!node) throw new Error(`Source not found: ${source}`);
  const target = findNode(mockFileTree, targetFolder);
  if (!target || target.node_type !== "folder") {
    throw new Error(`Target folder not found: ${targetFolder}`);
  }

  removeNode(mockFileTree, source);

  const newPath =
    targetFolder === "/"
      ? `/${node.name}`
      : `${targetFolder}/${node.name}`;

  // Avoid collision
  let finalPath = newPath;
  let counter = 1;
  while (findNode(mockFileTree, finalPath)) {
    const base = node.name.replace(/\.[^.]+$/, "");
    const ext = node.name.match(/\.[^.]+$/)?.[0] ?? "";
    finalPath =
      targetFolder === "/"
        ? `/${base} (${counter})${ext}`
        : `${targetFolder}/${base} (${counter})${ext}`;
    counter++;
  }

  const moved: FileNode = {
    ...node,
    path: finalPath,
    id: finalPath,
  };

  // Rebase children paths
  function rebase(nodes: FileNode[], oldPrefix: string, newPrefix: string) {
    for (const n of nodes) {
      if (n.path.startsWith(oldPrefix)) {
        const prevPath = n.path;
        n.path = prevPath.replace(oldPrefix, newPrefix);
        n.id = n.path;
        const c = mockFileContents.get(prevPath);
        if (c !== undefined) {
          mockFileContents.delete(prevPath);
          mockFileContents.set(n.path, c);
        }
      }
      if (n.children) rebase(n.children, oldPrefix, newPrefix);
    }
  }

  if (moved.children) {
    rebase(moved.children, source, finalPath);
  }

  // Update content key for the node itself
  const content = mockFileContents.get(source);
  if (content !== undefined) {
    mockFileContents.delete(source);
    mockFileContents.set(finalPath, content);
  }

  addChild(mockFileTree, targetFolder, moved);
  return finalPath;
}

// ─── Pin / Recent ───

const mockPinned = new Set<string>(mockAppState.pinned_files);
const mockRecent = [...mockAppState.recent_files];

export async function togglePin(path: string): Promise<boolean> {
  await delay(20);
  if (mockPinned.has(path)) {
    mockPinned.delete(path);
    return false;
  }
  mockPinned.add(path);
  return true;
}

export async function getPinnedFiles(): Promise<string[]> {
  await delay(20);
  return Array.from(mockPinned);
}

export async function getRecentFiles(): Promise<string[]> {
  await delay(20);
  return [...mockRecent];
}

// ─── Search ───

export async function searchWorkspace(query: string): Promise<SearchResult[]> {
  await delay(100);
  return mockSearchResults(query);
}

export async function searchAllVaults(
  query: string
): Promise<SearchResult[]> {
  return searchWorkspace(query);
}

// ─── App State ───

const MOCK_STATE_KEY = "wenmei-mock-app-state";

function loadMockAppState(): AppPersistedState {
  if (typeof window === "undefined") return { ...mockAppState };
  try {
    const raw = window.localStorage.getItem(MOCK_STATE_KEY);
    return raw ? { ...mockAppState, ...JSON.parse(raw) } : { ...mockAppState };
  } catch {
    return { ...mockAppState };
  }
}

function persistMockAppState() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOCK_STATE_KEY, JSON.stringify(currentAppState));
  } catch {
    // Browser dev mode should keep working even if localStorage is unavailable.
  }
}

let currentAppState: AppPersistedState = loadMockAppState();

export async function getAppState(): Promise<AppPersistedState> {
  await delay(20);
  return { ...currentAppState };
}

export async function saveAppState(
  state: AppPersistedState
): Promise<void> {
  await delay(20);
  currentAppState = { ...state };
  persistMockAppState();
}

// ─── Workspace / Vault / Sandbox ───

export async function getWorkspacePath(): Promise<string> {
  return "/Users/dev/wenmei";
}

export async function getInitialFile(): Promise<string | null> {
  return null;
}

export async function installCliIntegration(): Promise<string> {
  return "Mock: CLI integration not available in browser mode.";
}

export async function runInstallScript(scriptName: string): Promise<string> {
  return `Mock: would run ${scriptName}`;
}

export async function completeOnboarding(): Promise<void> {
  currentAppState.onboarding_completed = true;
  persistMockAppState();
}

export async function ensureDefaultVault(): Promise<{
  is_new: boolean;
  welcome_created: boolean;
  vault_path: string;
  welcome_path: string;
}> {
  await delay(50);
  const vaultPath = "/Users/dev/Documents/Wenmei";
  const existingVault = mockVaults.find(v => v.path === vaultPath);
  const isNew = !existingVault;
  for (const v of mockVaults) v.is_active = false;
  if (existingVault) {
    existingVault.is_active = true;
    currentAppState.active_vault_id = existingVault.id;
  } else {
    const vault: Vault = {
      id: `vault-mock-${Date.now()}`,
      name: "Wenmei",
      path: vaultPath,
      is_active: true,
    };
    mockVaults.push(vault);
    currentAppState.active_vault_id = vault.id;
  }
  currentAppState.vaults = [...mockVaults];
  currentAppState.open_mode = "vault";
  currentAppState.metadata_mode = "local";
  currentAppState.sandbox_auth_status = "promoted";
  currentAppState.last_active_file = "/Welcome.md";

  const welcomeCreated = !findNode(mockFileTree, "/Welcome.md");
  if (!findNode(mockFileTree, "/Welcome.md")) {
    addChild(mockFileTree, "/", {
      id: "/Welcome.md",
      name: "Welcome.md",
      path: "/Welcome.md",
      node_type: "file",
      is_pinned: false,
      is_recent: false,
      modified_at: new Date().toISOString(),
    });
  }
  mockFileContents.set(
    "/Welcome.md",
    "# Welcome to Wenmei\n\nThis mock welcome note is created by browser dev onboarding.\n"
  );
  persistMockAppState();
  return {
    is_new: isNew,
    welcome_created: welcomeCreated,
    vault_path: vaultPath,
    welcome_path: "/Welcome.md",
  };
}

export async function cliIntegrationStatus(): Promise<CliStatus> {
  return { installed: false, path: null, version: null };
}

export async function openFolderDialog(): Promise<string | null> {
  // In browser mock mode, just return null or a fixed path
  return null;
}

export async function setWorkspacePath(_newPath: string): Promise<void> {
  // no-op in mock
}

export async function listVaults(): Promise<Vault[]> {
  await delay(20);
  return [...mockVaults];
}

export async function addVault(path: string): Promise<Vault> {
  await delay(30);
  for (const v of mockVaults) v.is_active = false;
  const vault: Vault = {
    id: `vault-mock-${Date.now()}`,
    name: path.split("/").pop() ?? "Vault",
    path,
    is_active: true,
  };
  mockVaults.push(vault);
  currentAppState.vaults = [...mockVaults];
  currentAppState.active_vault_id = vault.id;
  persistMockAppState();
  return vault;
}

export async function setActiveVault(id: string): Promise<void> {
  await delay(20);
  for (const v of mockVaults) v.is_active = v.id === id;
}

export async function listSandboxes(): Promise<Sandbox[]> {
  await delay(20);
  return [...mockSandboxes];
}

export async function createSandbox(
  name: string,
  rootPath: string,
  _kind = "folder"
): Promise<Sandbox> {
  await delay(30);
  const sandbox: Sandbox = {
    id: `sandbox-mock-${Date.now()}`,
    name,
    vault_id: "vault-mock-001",
    root_path: rootPath,
    kind: "folder",
    is_active: false,
  };
  mockSandboxes.push(sandbox);
  return sandbox;
}

export async function setActiveSandbox(id: string): Promise<void> {
  await delay(20);
  for (const s of mockSandboxes) s.is_active = s.id === id;
}

export async function getActionLog(): Promise<string[]> {
  await delay(20);
  return [...currentAppState.action_log];
}

export async function getSandboxRegistry(): Promise<SandboxRegistry> {
  await delay(20);
  return { ...mockSandboxRegistry };
}

export async function authorizeActiveWorkspace(
  _metadataMode: "global" | "local" = "global"
): Promise<AuthorizedSandbox> {
  await delay(30);
  return mockSandboxRegistry.sandboxes[0];
}

export async function promoteActiveWorkspace(): Promise<AuthorizedSandbox> {
  return authorizeActiveWorkspace();
}

// ─── Journal ───

export async function appendJournal(
  kind: string,
  source: string,
  path: string | null,
  summary: string,
  metadata: unknown = {}
): Promise<void> {
  await delay(20);
  mockJournalEvents.unshift({
    ts: new Date().toISOString(),
    vault_id: "vault-mock-001",
    sandbox_id: "default-root",
    kind,
    source,
    path,
    summary,
    metadata,
  });
}

export async function listJournalEvents(
  limit = 50
): Promise<JournalEvent[]> {
  await delay(20);
  return mockJournalEvents.slice(0, limit);
}

// ─── Review Session ───

let mockReviewSession: { id: string; entries: Record<string, unknown> } | null =
  null;

export async function reviewSessionStart(): Promise<string> {
  await delay(20);
  const id = `rs-${Date.now()}`;
  mockReviewSession = { id, entries: {} };
  return id;
}

export async function reviewSessionClose(_discard = false): Promise<void> {
  await delay(20);
  mockReviewSession = null;
}

export async function reviewApprove(path: string): Promise<void> {
  await delay(20);
  if (mockReviewSession) {
    delete mockReviewSession.entries[path];
  }
}

export async function reviewReject(path: string): Promise<void> {
  await delay(20);
  if (mockReviewSession) {
    delete mockReviewSession.entries[path];
  }
}

export async function reviewChangeset(): Promise<unknown[]> {
  await delay(20);
  return mockReviewSession
    ? Object.values(mockReviewSession.entries)
    : [];
}

export async function reviewAnnotate(
  path: string,
  reviewer: string,
  riskLevel: string | undefined,
  proposedDecision: string | undefined,
  annotation: string
): Promise<void> {
  await delay(20);
  mockJournalEvents.unshift({
    ts: new Date().toISOString(),
    vault_id: "default",
    sandbox_id: "default-root",
    kind: "review.annotation",
    source: reviewer,
    path,
    summary: annotation,
    metadata: {
      risk_level: riskLevel,
      proposed_decision: proposedDecision,
    },
  });
}

// ─── Terminal ───

export async function terminalStart(
  _rows: number,
  _cols: number,
  _forceRestart = false
): Promise<TerminalStarted> {
  await delay(50);
  return mockTerminalStart();
}

export async function terminalWrite(_data: string): Promise<void> {
  // no-op in mock
}

export async function terminalResize(
  _rows: number,
  _cols: number
): Promise<void> {
  // no-op in mock
}

export async function terminalStop(): Promise<void> {
  // no-op in mock
}

export async function terminalSetNarrationEnabled(_enabled: boolean): Promise<boolean> {
  return _enabled;
}

// ─── Utilities ───

export async function copyFilePath(path: string): Promise<string> {
  return path;
}

export async function revealInFolder(_path: string): Promise<void> {
  // no-op in mock
}

// ─── Pi Panel RPC ───

export async function piPanelStart(
  _thinking?: string | null,
  _forceRestart = false
): Promise<PiPanelStarted> {
  await delay(50);
  return mockPiPanelStart();
}

export async function piPanelPrompt(
  _id: string,
  message: string
): Promise<void> {
  await delay(200);
  // Simulate a response after a short delay via the event system
  setTimeout(() => {
    const event = new CustomEvent<PiMessage>("pi-rpc-event", {
      detail: {
        id: `mock-reply-${Date.now()}`,
        role: "system",
        type: "chat",
        text: `You said: "${message}"\\n\\n(Mock mode — no real Pi backend connected.)`,
      },
    });
    window.dispatchEvent(event);
  }, 300);
}

export async function piPanelAbort(): Promise<void> {
  // no-op
}

export async function piPanelRestart(
  _thinking?: string | null
): Promise<PiPanelStarted> {
  return piPanelStart();
}

export async function piPanelStop(): Promise<void> {
  // no-op
}

// ─── Pty ───

import type { PtyCommand, PtyResult } from "@/lib/tauri-bridge";

export async function ptyRunCommands(
  _commands: PtyCommand[],
  _onData: (data: string) => void
): Promise<PtyResult> {
  await delay(100);
  return { failed: false };
}
