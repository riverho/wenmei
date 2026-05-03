import { invoke as rawInvoke } from "@tauri-apps/api/core";
import * as mocks from "@/mocks/mock-bridge";
import { open } from "@tauri-apps/plugin-dialog";
const isTauri =
  typeof window !== "undefined" &&
  !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;

async function invoke<T>(cmd: string, args?: unknown): Promise<T> {
  if (!isTauri) {
    return mockInvoke(cmd, args) as Promise<T>;
  }
  return rawInvoke(cmd, args as never);
}

async function mockInvoke(cmd: string, args?: unknown): Promise<unknown> {
  switch (cmd) {
    case "list_files":
      return mocks.listFiles();
    case "read_file":
      return mocks.readFile((args as { path: string }).path);
    case "write_file":
      return mocks.writeFile(
        (args as { path: string }).path,
        (args as { content: string }).content
      );
    case "create_file":
      return mocks.createFile(
        (args as { parentPath: string }).parentPath,
        (args as { name: string }).name
      );
    case "create_folder":
      return mocks.createFolder(
        (args as { parentPath: string }).parentPath,
        (args as { name: string }).name
      );
    case "rename_file":
      return mocks.renameFile(
        (args as { oldPath: string }).oldPath,
        (args as { newName: string }).newName
      );
    case "delete_file":
      return mocks.deleteFile((args as { path: string }).path);
    case "move_file":
      return mocks.moveFile(
        (args as { source: string }).source,
        (args as { targetFolder: string }).targetFolder
      );
    case "toggle_pin":
      return mocks.togglePin((args as { path: string }).path);
    case "get_pinned_files":
      return mocks.getPinnedFiles();
    case "get_recent_files":
      return mocks.getRecentFiles();
    case "search_workspace":
      return mocks.searchWorkspace((args as { query: string }).query);
    case "search_all_vaults":
      return mocks.searchAllVaults((args as { query: string }).query);
    case "get_app_state":
      return mocks.getAppState();
    case "save_app_state":
      return mocks.saveAppState(
        (args as { newState: AppPersistedState }).newState
      );
    case "get_workspace_path":
      return mocks.getWorkspacePath();
    case "get_initial_file":
      return mocks.getInitialFile();
    case "install_cli_integration":
      return mocks.installCliIntegration();
    case "run_install_script":
      return mocks.runInstallScript(
        (args as { scriptName: string }).scriptName
      );
    case "complete_onboarding":
      return mocks.completeOnboarding();
    case "ensure_default_vault":
      return mocks.ensureDefaultVault();
    case "cli_integration_status":
      return mocks.cliIntegrationStatus();
    case "set_workspace_path":
      return mocks.setWorkspacePath((args as { newPath: string }).newPath);
    case "list_vaults":
      return mocks.listVaults();
    case "add_vault":
      return mocks.addVault((args as { path: string }).path);
    case "set_active_vault":
      return mocks.setActiveVault((args as { id: string }).id);
    case "list_sandboxes":
      return mocks.listSandboxes();
    case "create_sandbox":
      return mocks.createSandbox(
        (args as { name: string }).name,
        (args as { rootPath: string }).rootPath,
        (args as { kind: string }).kind
      );
    case "set_active_sandbox":
      return mocks.setActiveSandbox((args as { id: string }).id);
    case "get_action_log":
      return mocks.getActionLog();
    case "get_sandbox_registry":
      return mocks.getSandboxRegistry();
    case "authorize_active_workspace":
      return mocks.authorizeActiveWorkspace(
        (args as { metadataMode: "global" | "local" }).metadataMode
      );
    case "promote_active_workspace":
      return mocks.promoteActiveWorkspace();
    case "append_journal":
      return mocks.appendJournal(
        (args as { kind: string }).kind,
        (args as { source: string }).source,
        (args as { path: string | null }).path,
        (args as { summary: string }).summary,
        (args as { metadata: unknown }).metadata
      );
    case "list_journal_events":
      return mocks.listJournalEvents((args as { limit: number }).limit);
    case "terminal_start":
      return mocks.terminalStart(
        (args as { rows: number }).rows,
        (args as { cols: number }).cols,
        (args as { forceRestart?: boolean }).forceRestart
      );
    case "terminal_write":
      return mocks.terminalWrite((args as { data: string }).data);
    case "terminal_resize":
      return mocks.terminalResize(
        (args as { rows: number }).rows,
        (args as { cols: number }).cols
      );
    case "terminal_stop":
      return mocks.terminalStop();
    case "copy_file_path":
      return mocks.copyFilePath((args as { path: string }).path);
    case "reveal_in_folder":
      return mocks.revealInFolder((args as { path: string }).path);
    case "pi_panel_start":
      return mocks.piPanelStart(
        (args as { thinking: string | null }).thinking,
        (args as { forceRestart?: boolean }).forceRestart
      );
    case "pi_panel_prompt":
      return mocks.piPanelPrompt(
        (args as { id: string }).id,
        (args as { message: string }).message
      );
    case "pi_panel_abort":
      return mocks.piPanelAbort();
    case "pi_panel_restart":
      return mocks.piPanelRestart(
        (args as { thinking: string | null }).thinking
      );
    case "pi_panel_stop":
      return mocks.piPanelStop();
    case "pty_run_commands":
      return mocks.ptyRunCommands(
        (args as { commands: PtyCommand[] }).commands,
        (args as { onData: (data: string) => void }).onData
      );
    default:
      throw new Error(`Unhandled mock command: ${cmd}`);
  }
}

// ─── Data Types (mirrors Rust structs) ───

export interface FileNode {
  id: string;
  name: string;
  path: string;
  node_type: "file" | "folder";
  children?: FileNode[];
  is_pinned: boolean;
  is_recent: boolean;
  modified_at?: string;
}

export interface FileContent {
  path: string;
  content: string;
  name: string;
}

export interface SearchResult {
  vault_id: string;
  vault_name: string;
  path: string;
  name: string;
  line_number: number;
  snippet: string;
}

export interface Vault {
  id: string;
  name: string;
  path: string;
  is_active: boolean;
}

export interface Sandbox {
  id: string;
  name: string;
  vault_id: string;
  root_path: string;
  kind: string;
  is_active: boolean;
}

export interface AppPersistedState {
  first_run_at: string | null;
  onboarding_completed: boolean;
  left_panel_open: boolean;
  right_panel_open: boolean;
  view_mode: string;
  theme: string;
  last_active_file: string | null;
  left_panel_width: number;
  right_panel_width: number;
  split_ratio: number;
  open_folders: string[];
  pinned_files: string[];
  recent_files: string[];
  vaults: Vault[];
  active_vault_id: string;
  sandboxes: Sandbox[];
  active_sandbox_id: string | null;
  action_log: string[];
  open_mode: string;
  metadata_mode: string;
  sandbox_auth_status: string;
}

export interface RecentDocument {
  path: string;
  root_path: string;
  opened_at: string;
}

export interface AuthorizedSandbox {
  id: string;
  display_name: string;
  kind: string;
  roots: string[];
  primary_root: string;
  metadata_mode: string;
  local_meta_path?: string | null;
  trust_mode: string;
  allow_pi: boolean;
  allow_terminal: boolean;
  allow_cross_folder: boolean;
  authorized_at: string;
  auth_source: string;
}

export interface SandboxRegistry {
  version: number;
  sandboxes: AuthorizedSandbox[];
  recent_documents: RecentDocument[];
}

// ─── File Operations ───

export async function listFiles(): Promise<FileNode[]> {
  return invoke("list_files");
}

export async function readFile(path: string): Promise<FileContent> {
  return invoke("read_file", { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  return invoke("write_file", { path, content });
}

export async function createFile(
  parentPath: string,
  name: string
): Promise<string> {
  return invoke("create_file", { parentPath, name });
}

export async function createFolder(
  parentPath: string,
  name: string
): Promise<string> {
  return invoke("create_folder", { parentPath, name });
}

export async function renameFile(
  oldPath: string,
  newName: string
): Promise<string> {
  return invoke("rename_file", { oldPath, newName });
}

export async function deleteFile(path: string): Promise<void> {
  return invoke("delete_file", { path });
}

export async function moveFile(
  source: string,
  targetFolder: string
): Promise<string> {
  return invoke("move_file", { source, targetFolder });
}

// ─── Pin / Recent ───

export async function togglePin(path: string): Promise<boolean> {
  return invoke("toggle_pin", { path });
}

export async function getPinnedFiles(): Promise<string[]> {
  return invoke("get_pinned_files");
}

export async function getRecentFiles(): Promise<string[]> {
  return invoke("get_recent_files");
}

// ─── Search ───

export async function searchWorkspace(query: string): Promise<SearchResult[]> {
  return invoke("search_workspace", { query });
}

export async function searchAllVaults(query: string): Promise<SearchResult[]> {
  return invoke("search_all_vaults", { query });
}

// ─── App State Persistence ───

export async function getAppState(): Promise<AppPersistedState> {
  return invoke("get_app_state");
}

export async function saveAppState(state: AppPersistedState): Promise<void> {
  return invoke("save_app_state", { newState: state });
}

// ─── Workspace ───

export async function getWorkspacePath(): Promise<string> {
  return invoke("get_workspace_path");
}

export async function getInitialFile(): Promise<string | null> {
  return invoke("get_initial_file");
}

export async function installCliIntegration(): Promise<string> {
  return invoke("install_cli_integration");
}

export async function runInstallScript(scriptName: string): Promise<string> {
  return invoke("run_install_script", { scriptName });
}

export async function completeOnboarding(): Promise<void> {
  return invoke("complete_onboarding");
}

export interface EnsureDefaultVaultResult {
  is_new: boolean;
  welcome_created: boolean;
  vault_path: string;
  welcome_path: string;
}

export async function ensureDefaultVault(): Promise<EnsureDefaultVaultResult> {
  return invoke("ensure_default_vault");
}

export interface CliStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
}

export async function cliIntegrationStatus(): Promise<CliStatus> {
  return invoke("cli_integration_status");
}

export async function openFolderDialog(): Promise<string | null> {
  if (!isTauri) return mocks.openFolderDialog();
  const result = await open({ directory: true });
  return result ?? null;
}

export async function setWorkspacePath(newPath: string): Promise<void> {
  return invoke("set_workspace_path", { newPath });
}

export async function listVaults(): Promise<Vault[]> {
  return invoke("list_vaults");
}

export async function addVault(path: string): Promise<Vault> {
  return invoke("add_vault", { path });
}

export async function setActiveVault(id: string): Promise<void> {
  return invoke("set_active_vault", { id });
}

export async function listSandboxes(): Promise<Sandbox[]> {
  return invoke("list_sandboxes");
}

export async function createSandbox(
  name: string,
  rootPath: string,
  kind = "folder"
): Promise<Sandbox> {
  return invoke("create_sandbox", { name, rootPath, kind });
}

export async function setActiveSandbox(id: string): Promise<void> {
  return invoke("set_active_sandbox", { id });
}

export async function getActionLog(): Promise<string[]> {
  return invoke("get_action_log");
}

export async function getSandboxRegistry(): Promise<SandboxRegistry> {
  return invoke("get_sandbox_registry");
}

export async function authorizeActiveWorkspace(
  metadataMode: "global" | "local" = "global"
): Promise<AuthorizedSandbox> {
  return invoke("authorize_active_workspace", { metadataMode });
}

export async function promoteActiveWorkspace(): Promise<AuthorizedSandbox> {
  return invoke("promote_active_workspace");
}

export interface JournalEvent {
  ts: string;
  vault_id: string;
  sandbox_id: string;
  kind: string;
  source: string;
  path?: string | null;
  summary: string;
  metadata: unknown;
}

export async function appendJournal(
  kind: string,
  source: string,
  path: string | null,
  summary: string,
  metadata: unknown = {}
): Promise<void> {
  return invoke("append_journal", { kind, source, path, summary, metadata });
}

export async function listJournalEvents(limit = 50): Promise<JournalEvent[]> {
  return invoke("list_journal_events", { limit });
}

// ─── Terminal ───

export interface TerminalStarted {
  cwd: string;
  log_file: string;
  reused: boolean;
  snapshot: number[];
}

export async function terminalStart(
  rows: number,
  cols: number,
  forceRestart = false
): Promise<TerminalStarted> {
  return invoke("terminal_start", { rows, cols, forceRestart });
}

export async function terminalWrite(data: string): Promise<void> {
  return invoke("terminal_write", { data });
}

export async function terminalResize(
  rows: number,
  cols: number
): Promise<void> {
  return invoke("terminal_resize", { rows, cols });
}

export async function terminalStop(): Promise<void> {
  return invoke("terminal_stop");
}

// ─── Utilities ───

export async function copyFilePath(path: string): Promise<string> {
  return invoke("copy_file_path", { path });
}

export async function revealInFolder(path: string): Promise<void> {
  return invoke("reveal_in_folder", { path });
}

// ─── Pi Panel RPC ───

export interface PiPanelStarted {
  cwd: string;
  session_dir: string;
  reused: boolean;
  thinking?: string | null;
}

export async function piPanelStart(
  thinking?: string | null,
  forceRestart = false
): Promise<PiPanelStarted> {
  return invoke("pi_panel_start", { thinking, forceRestart });
}

export async function piPanelPrompt(
  id: string,
  message: string
): Promise<void> {
  return invoke("pi_panel_prompt", { id, message });
}

export async function piPanelAbort(): Promise<void> {
  return invoke("pi_panel_abort");
}

export async function piPanelRestart(
  thinking?: string | null
): Promise<PiPanelStarted> {
  return invoke("pi_panel_restart", { thinking });
}

export async function piPanelStop(): Promise<void> {
  return invoke("pi_panel_stop");
}

// ─── Pi command messages ───

export interface PiMessage {
  id: string;
  role: "user" | "system";
  text: string;
  type: "chat" | "diff" | "log" | "confirm" | "action";
  actions?: { label: string; action: string }[];
}

// ─── Pty ───

export interface PtyCommand {
  cmd: string;
  label: string;
}

export interface PtyResult {
  failed: boolean;
}

export interface PtyRunOptions {
  onData: (data: string) => void;
}

export async function ptyRunCommands(
  commands: PtyCommand[],
  onData: (data: string) => void
): Promise<PtyResult> {
  return invoke("pty_run_commands", { commands, onData });
}
