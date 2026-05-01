import { invoke } from "@tauri-apps/api/core";

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

export async function cliIntegrationStatus(): Promise<boolean> {
  return invoke("cli_integration_status");
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
  cols: number
): Promise<TerminalStarted> {
  return invoke("terminal_start", { rows, cols });
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
  thinking?: string | null
): Promise<PiPanelStarted> {
  return invoke("pi_panel_start", { thinking });
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
