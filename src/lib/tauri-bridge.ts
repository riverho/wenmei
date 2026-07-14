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
        (args as { content: string }).content,
        (args as { source?: string }).source
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
    case "remove_vault":
      return mocks.removeVault((args as { id: string }).id);
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
    case "build_briefing":
      return mocks
        .listJournalEvents((args as { limit: number }).limit)
        .then(events =>
          [
            "# BRIEFING",
            "",
            "Recent sandbox context for the next agent session.",
            "",
            ...events.map(e => `- ${e.ts} [${e.kind}]: ${e.summary}`),
          ].join("\n")
        );
    case "night_shift_start":
      return {
        id: `night-${Date.now()}`,
        status: "waiting_for_review",
        task_count: 0,
        tasks: [],
        briefing_path: ".wenmei/nightshift/last-run.json",
        created_at: new Date().toISOString(),
      };
    case "night_shift_status":
      return null;
    case "export_audit":
      return {
        json_path: ".wenmei/audit/audit-mock.json",
        markdown_path: ".wenmei/audit/audit-mock.md",
        event_count: 0,
      };
    case "review_session_start":
      return mocks.reviewSessionStart();
    case "review_session_close":
      return mocks.reviewSessionClose((args as { discard: boolean }).discard);
    case "clear_review_staging":
      return mocks.clearReviewStaging();
    case "review_capture_version":
      return mocks.reviewCaptureVersion((args as { path: string }).path);
    case "review_approve":
      return mocks.reviewApprove((args as { path: string }).path);
    case "review_reject":
      return mocks.reviewReject((args as { path: string }).path);
    case "review_changeset":
      return mocks.reviewChangeset();
    case "review_file_versions":
      return mocks.reviewFileVersions((args as { path: string }).path);
    case "review_annotate":
      return mocks.reviewAnnotate(
        (args as { path: string }).path,
        (args as { reviewer: string }).reviewer,
        (args as { riskLevel?: string }).riskLevel,
        (args as { proposedDecision?: string }).proposedDecision,
        (args as { annotation: string }).annotation
      );
    case "terminal_start":
      return mocks.terminalStart(
        (args as { rows: number }).rows,
        (args as { cols: number }).cols,
        (args as { forceRestart?: boolean }).forceRestart
      );
    case "terminal_write":
      return mocks.terminalWrite((args as { data: string }).data);
    case "pi_type_into_terminal":
      return mocks.terminalWrite((args as { text: string }).text);
    case "terminal_resize":
      return mocks.terminalResize(
        (args as { rows: number }).rows,
        (args as { cols: number }).cols
      );
    case "terminal_set_active":
      return undefined;
    case "terminal_statuses":
      return [];
    case "terminal_stop":
      return mocks.terminalStop();
    case "terminal_set_narration_enabled":
      return mocks.terminalSetNarrationEnabled(
        (args as { enabled: boolean }).enabled
      );
    case "copy_file_path":
      return mocks.copyFilePath((args as { path: string }).path);
    case "reveal_in_folder":
      return mocks.revealInFolder((args as { path: string }).path);
    case "open_file_window":
      return undefined;
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

export interface AgentProfile {
  id: string;
  name: string;
  launch_command: string;
  injection_style: string;
  submit_sequence: string;
  output_patterns: string[];
}

export interface Recipe {
  id: string;
  name: string;
  folder: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
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
  agent_profiles?: AgentProfile[];
  recipes?: Recipe[];
  license_tier?: "free" | "pro";
  license_key?: string | null;
  narrate_by_default?: boolean;
  heartbeat_enabled?: boolean;
  heartbeat_interval_minutes?: number;
  agent_process_names?: string[];
  terminal_tab_limit?: number;
  terminal_tabs_unlimited?: boolean;
  sandbox_new_windows?: boolean;
  narration_depth?: string;
  keymap?: Record<string, string>;
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

export type PlatformName = "windows" | "macos" | "linux";

export async function getPlatform(): Promise<PlatformName> {
  return invoke("get_platform");
}

export async function listFiles(): Promise<FileNode[]> {
  return invoke("list_files");
}

export async function readFile(path: string): Promise<FileContent> {
  return invoke("read_file", { path });
}

export async function writeFile(
  path: string,
  content: string,
  source: "human" | "agent" = "human"
): Promise<void> {
  return invoke("write_file", { path, content, source });
}

export async function clearReviewStaging(): Promise<void> {
  return invoke("clear_review_staging");
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

export async function trashSize(): Promise<number> {
  return invoke("trash_size");
}

export async function emptyTrash(): Promise<void> {
  return invoke("empty_trash");
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

/** Soft-remove: detach a vault from the list (state.json). Files untouched.
 *  Returns the remaining vaults. Rejects on the active vault. */
export async function removeVault(id: string): Promise<Vault[]> {
  return invoke("remove_vault", { id });
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

export async function buildBriefing(limit = 20): Promise<string> {
  return invoke("build_briefing", { limit });
}

export interface NightShiftRun {
  id: string;
  status: string;
  task_count: number;
  tasks: string[];
  briefing_path: string;
  created_at: string;
}

export async function nightShiftStart(): Promise<NightShiftRun> {
  return invoke("night_shift_start");
}

export async function nightShiftStatus(): Promise<NightShiftRun | null> {
  return invoke("night_shift_status");
}

// ─── Heartbeat run cards (docs/design/sentinel-ledger.md §4) ───

export type RunStatus =
  "idle" | "running" | "waiting_input" | "stuck" | "done" | "blocked";

export interface RunCard {
  id: string;
  goal: string;
  wake:
    | { kind: "interval"; secs: number }
    | { kind: "on_event"; event: string }
    | { kind: "manual" };
  stop:
    | { kind: "checks_pass"; command: string }
    | { kind: "human_gate" }
    | { kind: "budget"; tokens: number };
  status: RunStatus;
  created_at: string;
  last_progress_epoch: number;
  overdue_notified: boolean;
}

export async function runCardCreate(
  goal: string,
  wakeSecs?: number,
  humanGate?: boolean
): Promise<RunCard> {
  return invoke("run_card_create", { goal, wakeSecs, humanGate });
}

export async function runCardList(): Promise<RunCard[]> {
  return invoke("run_card_list");
}

export async function runCardSetStatus(
  id: string,
  status: RunStatus
): Promise<RunCard> {
  return invoke("run_card_set_status", { id, status });
}

export async function runCardTouch(id: string): Promise<void> {
  return invoke("run_card_touch", { id });
}

export async function runCardDelete(id: string): Promise<void> {
  return invoke("run_card_delete", { id });
}

/** Newer version string, null when up to date; rejects when updates are
 *  not configured (placeholder pubkey) or the network is unavailable. */
export async function checkForUpdate(): Promise<string | null> {
  return invoke("check_for_update");
}

// ─── Approval relay (docs/design/sentinel-ledger.md §3) ───

export interface PromptPattern {
  id: string;
  markers: string[];
  allow_keys: string;
  deny_keys: string;
  label: string;
}

export interface DetectedPrompt {
  pattern_id: string;
  label: string;
  prompt_text: string;
  screen_hash: number;
}

export async function listPromptPatterns(): Promise<PromptPattern[]> {
  return invoke("list_prompt_patterns");
}

/** The prompt currently on the active terminal, or null. */
export async function currentPrompt(): Promise<DetectedPrompt | null> {
  return invoke("current_prompt");
}

/** Inject the pattern's Allow/Deny keys — only if the screen still matches
 *  expectedHash (verify-then-act). Rejects if the prompt moved. */
export async function approvePrompt(
  patternId: string,
  allow: boolean,
  expectedHash: number
): Promise<void> {
  return invoke("approve_prompt", { patternId, allow, expectedHash });
}

export interface AuditExport {
  json_path: string;
  markdown_path: string;
  event_count: number;
}

export async function exportAudit(): Promise<AuditExport> {
  return invoke("export_audit");
}

// ─── Review Session / Changeset ───

export interface ChangesetEntry {
  path: string;
  status: "added" | "modified" | "deleted" | "baselineMissing";
  size: number;
  baseline_kind: "original" | "accepted";
  versions: ReviewVersion[];
}

export interface ReviewVersion {
  version: number;
  created_at: string;
  size: number;
}

export interface ReviewFileVersions {
  path: string;
  baseline: string;
  current: string;
}

export interface ReviewSession {
  id: string;
  started_at: string;
  entries: Record<string, ChangesetEntry>;
  known_paths: string[];
  total_baseline_bytes: number;
}

export async function reviewSessionStart(): Promise<string> {
  return invoke("review_session_start");
}

export async function reviewSessionClose(discard = false): Promise<void> {
  return invoke("review_session_close", { discard });
}

export async function reviewCaptureVersion(
  path: string
): Promise<ReviewVersion | null> {
  return invoke("review_capture_version", { path });
}

export async function reviewApprove(path: string): Promise<void> {
  return invoke("review_approve", { path });
}

export async function reviewReject(path: string): Promise<void> {
  return invoke("review_reject", { path });
}

export async function reviewChangeset(): Promise<ChangesetEntry[]> {
  return invoke("review_changeset");
}

export async function reviewFileVersions(
  path: string
): Promise<ReviewFileVersions> {
  return invoke("review_file_versions", { path });
}

export async function reviewAnnotate(
  path: string,
  reviewer: string,
  annotation: string,
  riskLevel?: string,
  proposedDecision?: string
): Promise<void> {
  return invoke("review_annotate", {
    path,
    reviewer,
    annotation,
    riskLevel,
    proposedDecision,
  });
}

// ─── Terminal ───

export type TerminalActivity = "active" | "idle" | "needs-input" | "stuck";

export interface TerminalStarted {
  session_id: string;
  sessionId?: string;
  cwd: string;
  log_file: string;
  reused: boolean;
  snapshot: number[];
  activity?: TerminalActivity;
}

export interface TerminalTabStatus {
  session_id: string;
  activity: TerminalActivity;
  idle_ms: number;
  agent: string | null;
}

export async function terminalStart(
  sessionId: string | null,
  sandboxId: string | null,
  rows: number,
  cols: number,
  forceRestart = false
): Promise<TerminalStarted> {
  return invoke("terminal_start", {
    sessionId,
    sandboxId,
    rows,
    cols,
    forceRestart,
  });
}

/** Live status for every running session — polled to paint the tab dots. */
export async function terminalStatuses(): Promise<TerminalTabStatus[]> {
  return invoke("terminal_statuses");
}

export async function terminalSetActive(sessionId: string): Promise<void> {
  return invoke("terminal_set_active", { sessionId });
}

export async function terminalWrite(
  sessionId: string | null,
  data: string
): Promise<void> {
  return invoke("terminal_write", { sessionId, data });
}

export async function piTypeIntoTerminal(
  text: string,
  origin: string
): Promise<void> {
  return invoke("pi_type_into_terminal", { text, origin });
}

export async function terminalResize(
  sessionId: string | null,
  rows: number,
  cols: number
): Promise<void> {
  return invoke("terminal_resize", { sessionId, rows, cols });
}

export async function terminalStop(sessionId: string | null): Promise<void> {
  return invoke("terminal_stop", { sessionId });
}

export async function terminalSetNarrationEnabled(
  sessionId: string | null,
  enabled: boolean
): Promise<boolean> {
  return invoke("terminal_set_narration_enabled", { sessionId, enabled });
}

// ─── Utilities ───

export async function copyFilePath(path: string): Promise<string> {
  return invoke("copy_file_path", { path });
}

export async function revealInFolder(path: string): Promise<void> {
  return invoke("reveal_in_folder", { path });
}

export async function openFileWindow(path: string): Promise<void> {
  return invoke("open_file_window", { path });
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
