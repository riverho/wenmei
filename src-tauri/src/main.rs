use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child as ProcessChild, ChildStdin, Command as ProcessCommand, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    pub id: String,
    pub name: String,
    pub path: String,
    pub node_type: String,
    pub children: Option<Vec<FileNode>>,
    pub is_pinned: bool,
    pub is_recent: bool,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub vault_id: String,
    pub vault_name: String,
    pub path: String,
    pub name: String,
    pub line_number: usize,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vault {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sandbox {
    pub id: String,
    pub name: String,
    pub vault_id: String,
    pub root_path: String,
    pub kind: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub left_panel_open: bool,
    pub right_panel_open: bool,
    pub view_mode: String,
    pub theme: String,
    pub last_active_file: Option<String>,
    pub left_panel_width: u32,
    pub right_panel_width: u32,
    pub split_ratio: f32,
    pub open_folders: Vec<String>,
    pub pinned_files: Vec<String>,
    pub recent_files: Vec<String>,
    pub vaults: Vec<Vault>,
    pub active_vault_id: String,
    pub sandboxes: Vec<Sandbox>,
    pub active_sandbox_id: Option<String>,
    pub action_log: Vec<String>,
    #[serde(default = "default_open_mode")]
    pub open_mode: String,
    #[serde(default = "default_metadata_mode")]
    pub metadata_mode: String,
    #[serde(default)]
    pub sandbox_auth_status: String,
}

impl AppState {
    fn with_default_vault(vault_path: PathBuf) -> Self {
        let vault = Vault {
            id: "default".to_string(),
            name: vault_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Wenmei")
                .to_string(),
            path: vault_path.to_string_lossy().to_string(),
            is_active: true,
        };
        Self {
            left_panel_open: true,
            right_panel_open: true,
            view_mode: "edit".to_string(),
            theme: "system".to_string(),
            last_active_file: None,
            left_panel_width: 280,
            right_panel_width: 360,
            split_ratio: 0.5,
            open_folders: vec!["/".to_string()],
            pinned_files: vec![],
            recent_files: vec![],
            vaults: vec![vault],
            active_vault_id: "default".to_string(),
            sandboxes: vec![Sandbox {
                id: "default-root".to_string(),
                name: "Root sandbox".to_string(),
                vault_id: "default".to_string(),
                root_path: "/".to_string(),
                kind: "vault".to_string(),
                is_active: true,
            }],
            active_sandbox_id: Some("default-root".to_string()),
            action_log: vec![],
            open_mode: "vault".to_string(),
            metadata_mode: "local".to_string(),
            sandbox_auth_status: "promoted".to_string(),
        }
    }
}

fn default_open_mode() -> String {
    "vault".to_string()
}

fn default_metadata_mode() -> String {
    "local".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentDocument {
    pub path: String,
    pub root_path: String,
    pub opened_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorizedSandbox {
    pub id: String,
    pub display_name: String,
    pub kind: String,
    pub roots: Vec<String>,
    pub primary_root: String,
    pub metadata_mode: String,
    pub local_meta_path: Option<String>,
    pub trust_mode: String,
    pub allow_pi: bool,
    pub allow_terminal: bool,
    pub allow_cross_folder: bool,
    pub authorized_at: String,
    pub auth_source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxRegistry {
    pub version: u32,
    pub sandboxes: Vec<AuthorizedSandbox>,
    pub recent_documents: Vec<RecentDocument>,
}

impl Default for SandboxRegistry {
    fn default() -> Self {
        Self {
            version: 1,
            sandboxes: vec![],
            recent_documents: vec![],
        }
    }
}

pub struct TerminalSession {
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub child: Arc<Mutex<Box<dyn PtyChild + Send + Sync>>>,
    pub master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    pub cwd: String,
    pub log_file: String,
    pub backlog: Arc<Mutex<Vec<u8>>>,
}

pub struct PiRpcSession {
    pub writer: Arc<Mutex<ChildStdin>>,
    pub child: Arc<Mutex<ProcessChild>>,
    pub cwd: String,
    pub session_dir: String,
    pub thinking: Option<String>,
}

pub struct WenmeiState {
    pub app_state: Mutex<AppState>,
    pub state_file: PathBuf,
    pub registry_file: PathBuf,
    pub terminal: Mutex<Option<TerminalSession>>,
    pub pi_rpc: Mutex<Option<PiRpcSession>>,
    pub initial_file: Mutex<Option<String>>,
}

#[derive(Debug, Clone, PartialEq)]
enum LaunchMode {
    Default,
    Document,
    Sandbox,
    Vault,
    Promote,
    Composite,
}

#[derive(Debug, Clone)]
struct LaunchIntent {
    mode: LaunchMode,
    root: Option<PathBuf>,
    initial_file: Option<PathBuf>,
    composite_name: Option<String>,
    composite_roots: Vec<PathBuf>,
}

impl Default for LaunchIntent {
    fn default() -> Self {
        Self {
            mode: LaunchMode::Default,
            root: None,
            initial_file: None,
            composite_name: None,
            composite_roots: vec![],
        }
    }
}

/// Parse CLI args into an open intent.
/// - First path-like arg is treated as a path.
/// - Wrapper commands/flags are accepted so direct `open --args` calls and
///   the bundled `wenmei` shim share one startup parser.
fn parse_launch_intent() -> LaunchIntent {
    let mut args: Vec<String> = vec![];
    let mut passthrough = false;
    for arg in std::env::args().skip(1) {
        if passthrough {
            args.push(arg);
            continue;
        }
        if arg == "--" {
            passthrough = true;
            continue;
        }
        if matches!(arg.as_str(), "--new-window" | "--reuse-window") {
            continue;
        }
        args.push(arg);
    }

    if args.is_empty() {
        return LaunchIntent::default();
    }

    let mut command = "open".to_string();
    if matches!(
        args[0].as_str(),
        "open" | "edit" | "create" | "new" | "mkdir" | "sandbox" | "vault" | "promote" | "composite"
    ) {
        command = args.remove(0);
    }

    if command == "composite" {
        if args.len() < 2 {
            return LaunchIntent::default();
        }
        let name = args.remove(0);
        let roots: Vec<PathBuf> = args
            .into_iter()
            .map(PathBuf::from)
            .map(|path| std::fs::canonicalize(&path).unwrap_or(path))
            .filter(|path| path.is_dir())
            .collect();
        return LaunchIntent {
            mode: LaunchMode::Composite,
            root: roots.first().cloned(),
            initial_file: None,
            composite_name: Some(name),
            composite_roots: roots,
        };
    }

    let raw = match args.into_iter().find(|arg| !arg.starts_with('-')) {
        Some(arg) => PathBuf::from(arg),
        None => return LaunchIntent::default(),
    };
    let abs = std::fs::canonicalize(&raw).unwrap_or(raw);

    let mode = match command.as_str() {
        "sandbox" => LaunchMode::Sandbox,
        "vault" => LaunchMode::Vault,
        "promote" => LaunchMode::Promote,
        _ => {
            if abs.is_file() {
                LaunchMode::Document
            } else {
                LaunchMode::Sandbox
            }
        }
    };

    if abs.is_dir() {
        LaunchIntent {
            mode,
            root: Some(abs),
            initial_file: None,
            composite_name: None,
            composite_roots: vec![],
        }
    } else if abs.is_file() {
        LaunchIntent {
            mode,
            root: abs.parent().map(|p| p.to_path_buf()),
            initial_file: Some(abs),
            composite_name: None,
            composite_roots: vec![],
        }
    } else {
        LaunchIntent::default()
    }
}

fn root_sandbox_id_for(vault_id: &str) -> String {
    if vault_id == "default" {
        "default-root".to_string()
    } else {
        format!("{}-root", vault_id)
    }
}

fn ensure_active_root_sandbox(app_state: &mut AppState, vault_id: &str) -> String {
    let existing = app_state
        .sandboxes
        .iter()
        .find(|sandbox| {
            sandbox.vault_id == vault_id
                && sandbox.kind == "vault"
                && sandbox.root_path == "/"
        })
        .map(|sandbox| sandbox.id.clone());

    let id = existing.unwrap_or_else(|| {
        let id = root_sandbox_id_for(vault_id);
        app_state.sandboxes.push(Sandbox {
            id: id.clone(),
            name: "Root sandbox".to_string(),
            vault_id: vault_id.to_string(),
            root_path: "/".to_string(),
            kind: "vault".to_string(),
            is_active: false,
        });
        id
    });

    for sandbox in &mut app_state.sandboxes {
        sandbox.is_active = sandbox.id == id && sandbox.vault_id == vault_id;
    }
    app_state.active_sandbox_id = Some(id.clone());
    id
}

fn init_vault_meta(path: &Path) {
    let meta = path.join(".wenmei");
    let _ = fs::create_dir_all(meta.join("terminal").join("logs"));
    let _ = fs::create_dir_all(meta.join("pi-sessions").join("default-root").join("terminal"));
    let _ = fs::create_dir_all(meta.join("pi-sessions").join("default-root").join("panel"));
    let _ = fs::create_dir_all(meta.join("trash"));
    let vault_json = meta.join("vault.json");
    if !vault_json.exists() {
        let raw = serde_json::json!({
            "version": 1,
            "created_at": chrono::Utc::now().to_rfc3339(),
            "default_sandbox_id": "default-root"
        });
        let _ = fs::write(vault_json, serde_json::to_string_pretty(&raw).unwrap_or_default());
    }
    let journal = meta.join("journal.jsonl");
    if !journal.exists() {
        let _ = fs::write(journal, "");
    }
}

fn load_registry(path: &Path) -> SandboxRegistry {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<SandboxRegistry>(&raw).ok())
        .unwrap_or_default()
}

fn save_registry_file(path: &Path, registry: &SandboxRegistry) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(registry).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

fn root_display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Wenmei")
        .to_string()
}

fn registry_id_for(prefix: &str) -> String {
    format!("{}-{}", prefix, chrono::Local::now().timestamp_millis())
}

fn upsert_registry_sandbox(
    registry: &mut SandboxRegistry,
    kind: &str,
    roots: Vec<PathBuf>,
    display_name: Option<String>,
    metadata_mode: &str,
    auth_source: &str,
) -> Option<AuthorizedSandbox> {
    let primary = roots.first()?.clone();
    let primary_root = primary.to_string_lossy().to_string();
    let root_strings: Vec<String> = roots
        .iter()
        .map(|root| root.to_string_lossy().to_string())
        .collect();
    let local_meta_path = if metadata_mode == "local" {
        Some(primary.join(".wenmei").to_string_lossy().to_string())
    } else {
        None
    };

    if let Some(existing) = registry
        .sandboxes
        .iter_mut()
        .find(|sandbox| sandbox.primary_root == primary_root && sandbox.kind == kind)
    {
        existing.roots = root_strings;
        existing.display_name = display_name.unwrap_or_else(|| root_display_name(&primary));
        existing.metadata_mode = metadata_mode.to_string();
        existing.local_meta_path = local_meta_path;
        existing.allow_cross_folder = kind == "composite" || existing.roots.len() > 1;
        existing.auth_source = auth_source.to_string();
        return Some(existing.clone());
    }

    let sandbox = AuthorizedSandbox {
        id: registry_id_for(if kind == "composite" { "composite" } else { "sandbox" }),
        display_name: display_name.unwrap_or_else(|| root_display_name(&primary)),
        kind: kind.to_string(),
        roots: root_strings,
        primary_root,
        metadata_mode: metadata_mode.to_string(),
        local_meta_path,
        trust_mode: "ask".to_string(),
        allow_pi: true,
        allow_terminal: true,
        allow_cross_folder: kind == "composite" || roots.len() > 1,
        authorized_at: chrono::Utc::now().to_rfc3339(),
        auth_source: auth_source.to_string(),
    };
    registry.sandboxes.push(sandbox.clone());
    Some(sandbox)
}

fn record_recent_document(registry: &mut SandboxRegistry, file: &Path, root: &Path) {
    let path = file.to_string_lossy().to_string();
    registry.recent_documents.retain(|doc| doc.path != path);
    registry.recent_documents.insert(
        0,
        RecentDocument {
            path,
            root_path: root.to_string_lossy().to_string(),
            opened_at: chrono::Utc::now().to_rfc3339(),
        },
    );
    registry.recent_documents.truncate(50);
}

fn ensure_active_workspace(
    app_state: &mut AppState,
    root: &Path,
    open_mode: &str,
    metadata_mode: &str,
    auth_status: &str,
    sandbox_kind: &str,
    sandbox_id: Option<String>,
) {
    let root_str = root.to_string_lossy().to_string();
    let vault_id = if let Some(existing) = app_state.vaults.iter().find(|v| v.path == root_str).cloned() {
        existing.id
    } else {
        let id = format!("vault-{}", chrono::Local::now().timestamp_millis());
        app_state.vaults.push(Vault {
            id: id.clone(),
            name: root_display_name(root),
            path: root_str,
            is_active: false,
        });
        id
    };

    for vault in &mut app_state.vaults {
        vault.is_active = vault.id == vault_id;
    }
    app_state.active_vault_id = vault_id.clone();
    app_state.open_folders = vec!["/".to_string()];
    app_state.open_mode = open_mode.to_string();
    app_state.metadata_mode = metadata_mode.to_string();
    app_state.sandbox_auth_status = auth_status.to_string();

    if open_mode == "document" {
        app_state.active_sandbox_id = None;
        for sandbox in &mut app_state.sandboxes {
            sandbox.is_active = false;
        }
    } else {
        let desired_id = sandbox_id.unwrap_or_else(|| root_sandbox_id_for(&vault_id));
        if !app_state
            .sandboxes
            .iter()
            .any(|sandbox| sandbox.id == desired_id && sandbox.vault_id == vault_id)
        {
            app_state.sandboxes.push(Sandbox {
                id: desired_id.clone(),
                name: if sandbox_kind == "composite" {
                    "Composite sandbox".to_string()
                } else {
                    "Root sandbox".to_string()
                },
                vault_id: vault_id.clone(),
                root_path: "/".to_string(),
                kind: sandbox_kind.to_string(),
                is_active: false,
            });
        }
        for sandbox in &mut app_state.sandboxes {
            sandbox.is_active = sandbox.id == desired_id && sandbox.vault_id == vault_id;
        }
        app_state.active_sandbox_id = Some(desired_id);
    }
}

impl WenmeiState {
    pub fn new() -> Self {
        let launch = parse_launch_intent();
        let fallback_vault = dirs::document_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Wenmei");

        let config_dir = dirs::config_dir()
            .unwrap_or_else(|| fallback_vault.join(".wenmei"))
            .join("Wenmei");
        fs::create_dir_all(&config_dir).unwrap_or_default();
        let state_file = config_dir.join("state.json");
        let registry_file = config_dir.join("sandboxes.json");
        let mut registry = load_registry(&registry_file);

        let mut loaded = fs::read_to_string(&state_file)
            .ok()
            .and_then(|raw| serde_json::from_str::<AppState>(&raw).ok())
            .unwrap_or_else(|| AppState::with_default_vault(fallback_vault.clone()));

        let mut initial_file_rel: Option<String> = None;

        if launch.mode == LaunchMode::Default {
            if loaded.open_mode.is_empty() {
                loaded.open_mode = "vault".to_string();
            }
            if loaded.metadata_mode.is_empty() {
                loaded.metadata_mode = "local".to_string();
            }
            if loaded.sandbox_auth_status.is_empty() {
                loaded.sandbox_auth_status = if loaded.metadata_mode == "local" {
                    "promoted".to_string()
                } else {
                    "authorized".to_string()
                };
            }
            let active_vault_id = loaded.active_vault_id.clone();
            ensure_active_root_sandbox(&mut loaded, &active_vault_id);
            if let Ok(vault) = active_vault_from_state(&loaded) {
                if loaded.metadata_mode == "local" {
                    init_vault_meta(Path::new(&vault.path));
                }
            }
        } else if launch.mode == LaunchMode::Composite {
            if let Some(root) = launch.root.clone() {
                fs::create_dir_all(&root).unwrap_or_default();
                let sandbox = upsert_registry_sandbox(
                    &mut registry,
                    "composite",
                    launch.composite_roots.clone(),
                    launch.composite_name.clone(),
                    "global",
                    "cli",
                );
                ensure_active_workspace(
                    &mut loaded,
                    &root,
                    "sandbox",
                    "global",
                    "authorized",
                    "composite",
                    sandbox.as_ref().map(|s| s.id.clone()),
                );
            }
        } else if let Some(root) = launch.root.clone() {
            fs::create_dir_all(&root).unwrap_or_default();
            let (open_mode, metadata_mode, auth_status, sandbox_kind, auth_source) = match launch.mode {
                LaunchMode::Document => ("document", "global", "none", "document", "document"),
                LaunchMode::Sandbox => ("sandbox", "global", "authorized", "sandbox", "cli"),
                LaunchMode::Vault => ("vault", "local", "promoted", "vault", "cli"),
                LaunchMode::Promote => ("vault", "local", "promoted", "vault", "promote"),
                _ => ("vault", "local", "promoted", "vault", "cli"),
            };

            if metadata_mode == "local" {
                init_vault_meta(&root);
            }

            let sandbox = if launch.mode == LaunchMode::Document {
                if let Some(file) = launch.initial_file.as_ref() {
                    record_recent_document(&mut registry, file, &root);
                }
                None
            } else {
                upsert_registry_sandbox(
                    &mut registry,
                    sandbox_kind,
                    vec![root.clone()],
                    None,
                    metadata_mode,
                    auth_source,
                )
            };

            ensure_active_workspace(
                &mut loaded,
                &root,
                open_mode,
                metadata_mode,
                auth_status,
                sandbox_kind,
                sandbox.as_ref().map(|s| s.id.clone()),
            );

            initial_file_rel = launch.initial_file.as_ref().and_then(|file| {
                file.strip_prefix(&root)
                    .ok()
                    .map(|rel| format!("/{}", rel.to_string_lossy()))
            });
            if initial_file_rel.is_some() {
                loaded.last_active_file = initial_file_rel.clone();
            }
        }

        for vault in &loaded.vaults {
            let _ = fs::create_dir_all(&vault.path);
        }

        let _ = fs::write(
            &state_file,
            serde_json::to_string_pretty(&loaded).unwrap_or_default(),
        );
        let _ = save_registry_file(&registry_file, &registry);

        Self {
            app_state: Mutex::new(loaded),
            state_file,
            registry_file,
            terminal: Mutex::new(None),
            pi_rpc: Mutex::new(None),
            initial_file: Mutex::new(initial_file_rel),
        }
    }
}

fn active_vault_from_state(app_state: &AppState) -> Result<Vault, String> {
    app_state
        .vaults
        .iter()
        .find(|v| v.id == app_state.active_vault_id)
        .cloned()
        .or_else(|| app_state.vaults.first().cloned())
        .ok_or_else(|| "No vault configured".to_string())
}

fn save_state(state: &State<'_, WenmeiState>) -> Result<(), String> {
    let app_state = state.app_state.lock().unwrap().clone();
    let raw = serde_json::to_string_pretty(&app_state).map_err(|e| e.to_string())?;
    fs::write(&state.state_file, raw).map_err(|e| e.to_string())
}

fn log_action(state: &State<'_, WenmeiState>, text: String) {
    let mut app_state = state.app_state.lock().unwrap();
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    app_state.action_log.insert(0, format!("{} — {}", ts, text));
    app_state.action_log.truncate(200);
}

fn active_vault(state: &State<'_, WenmeiState>) -> Result<Vault, String> {
    let app_state = state.app_state.lock().unwrap();
    app_state
        .vaults
        .iter()
        .find(|v| v.id == app_state.active_vault_id)
        .cloned()
        .or_else(|| app_state.vaults.first().cloned())
        .ok_or_else(|| "No vault configured".to_string())
}

pub struct TerminalContext {
    pub cwd: PathBuf,
    pub meta_root: PathBuf,
    pub sandbox_id: String,
}

fn safe_meta_name(value: &str) -> String {
    value
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

fn active_terminal_context(state: &State<'_, WenmeiState>) -> Result<TerminalContext, String> {
    let app_state = state.app_state.lock().unwrap();
    if app_state.open_mode == "document" || app_state.active_sandbox_id.is_none() {
        return Err("This folder is open in document mode. Authorize it as a sandbox before starting Pi or Terminal.".to_string());
    }
    let vault = app_state
        .vaults
        .iter()
        .find(|v| v.id == app_state.active_vault_id)
        .cloned()
        .or_else(|| app_state.vaults.first().cloned())
        .ok_or_else(|| "No vault configured".to_string())?;

    let sandbox = app_state
        .active_sandbox_id
        .as_ref()
        .and_then(|id| {
            app_state
                .sandboxes
                .iter()
                .find(|s| &s.id == id && s.vault_id == vault.id)
        })
        .cloned();

    let root_path = sandbox
        .as_ref()
        .map(|sandbox| sandbox.root_path.clone())
        .unwrap_or_else(|| "/".to_string());
    let sandbox_id = sandbox
        .as_ref()
        .map(|sandbox| sandbox.id.clone())
        .unwrap_or_else(|| format!("{}-root", vault.id));
    let metadata_mode = app_state.metadata_mode.clone();
    drop(app_state);

    let safe_sandbox_id = safe_meta_name(&sandbox_id);
    let meta_root = if metadata_mode == "local" {
        let root = PathBuf::from(&vault.path).join(".wenmei");
        init_vault_meta(Path::new(&vault.path));
        root
    } else {
        state
            .registry_file
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("sandbox-meta")
            .join(&safe_sandbox_id)
    };

    Ok(TerminalContext {
        cwd: resolve_path(&vault, &root_path)?,
        meta_root,
        sandbox_id: safe_sandbox_id,
    })
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn terminal_log_file(ctx: &TerminalContext) -> PathBuf {
    ctx.meta_root
        .join("terminal")
        .join("logs")
        .join(format!("{}.log", ctx.sandbox_id))
}

fn terminal_pi_session_dir(ctx: &TerminalContext) -> PathBuf {
    ctx.meta_root
        .join("pi-sessions")
        .join(&ctx.sandbox_id)
        .join("terminal")
}

fn panel_pi_session_dir(ctx: &TerminalContext) -> PathBuf {
    ctx.meta_root
        .join("pi-sessions")
        .join(&ctx.sandbox_id)
        .join("panel")
}

#[derive(Debug, Clone, Serialize)]
pub struct TerminalOutput {
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TerminalStarted {
    pub cwd: String,
    pub log_file: String,
    pub reused: bool,
    pub snapshot: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PiPanelStarted {
    pub cwd: String,
    pub session_dir: String,
    pub reused: bool,
    pub thinking: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PiRpcEvent {
    pub event: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct SandboxFilesChanged {
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalEvent {
    pub ts: String,
    pub vault_id: String,
    pub sandbox_id: String,
    pub kind: String,
    pub source: String,
    pub path: Option<String>,
    pub summary: String,
    pub metadata: serde_json::Value,
}

fn journal_path(ctx: &TerminalContext) -> PathBuf {
    ctx.meta_root.join("journal.jsonl")
}

fn append_journal_event(
    state: &State<'_, WenmeiState>,
    kind: &str,
    source: &str,
    path: Option<String>,
    summary: String,
    metadata: serde_json::Value,
) -> Result<(), String> {
    let app_state = state.app_state.lock().unwrap();
    let vault_id = app_state.active_vault_id.clone();
    let sandbox_id = app_state.active_sandbox_id.clone().unwrap_or_else(|| format!("{}-root", vault_id));
    drop(app_state);
    let ctx = active_terminal_context(state)?;
    let event = JournalEvent {
        ts: chrono::Utc::now().to_rfc3339(),
        vault_id,
        sandbox_id,
        kind: kind.to_string(),
        source: source.to_string(),
        path,
        summary,
        metadata,
    };
    let path = journal_path(&ctx);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut raw = serde_json::to_string(&event).map_err(|e| e.to_string())?;
    raw.push('\n');
    use std::fs::OpenOptions;
    let mut file = OpenOptions::new().create(true).append(true).open(path).map_err(|e| e.to_string())?;
    file.write_all(raw.as_bytes()).map_err(|e| e.to_string())
}

fn emit_files_changed(app: &AppHandle, reason: &str) {
    let _ = app.emit("sandbox-files-changed", SandboxFilesChanged { reason: reason.to_string() });
}

#[tauri::command]
fn append_journal(
    kind: String,
    source: String,
    path: Option<String>,
    summary: String,
    metadata: Option<serde_json::Value>,
    state: State<'_, WenmeiState>,
) -> Result<(), String> {
    append_journal_event(&state, &kind, &source, path, summary, metadata.unwrap_or_else(|| serde_json::json!({})))
}

#[tauri::command]
fn list_journal_events(limit: Option<usize>, state: State<'_, WenmeiState>) -> Result<Vec<JournalEvent>, String> {
    let ctx = active_terminal_context(&state)?;
    let raw = fs::read_to_string(journal_path(&ctx)).unwrap_or_default();
    let mut events: Vec<JournalEvent> = raw
        .lines()
        .filter_map(|line| serde_json::from_str::<JournalEvent>(line).ok())
        .collect();
    events.reverse();
    events.truncate(limit.unwrap_or(50));
    Ok(events)
}

fn terminal_boot_script(cwd: &Path, log_file: &Path, pi_session_dir: &Path) -> String {
    format!(
        r#"SANDBOX_DIR={sandbox_dir}
LOG_FILE={log_file}
log() {{
  /bin/mkdir -p "$(/usr/bin/dirname "$LOG_FILE")" 2>/dev/null || true
  /bin/echo "[$(/bin/date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE" 2>/dev/null || true
}}
clear
echo 'Wenmei sandbox:'
echo "$SANDBOX_DIR"
echo ''
log "embedded terminal opening cwd=$SANDBOX_DIR"
if ! cd "$SANDBOX_DIR" 2>/tmp/wenmei-cd-error.$$; then
  echo 'Wenmei cannot enter this sandbox folder.'
  echo "Reason: $(cat /tmp/wenmei-cd-error.$$ 2>/dev/null)"
  echo "Log: $LOG_FILE"
  log "cd failed: $(cat /tmp/wenmei-cd-error.$$ 2>/dev/null)"
  /bin/rm -f /tmp/wenmei-cd-error.$$ 2>/dev/null || true
  exec ${{SHELL:-/bin/zsh}} -l
fi
/bin/rm -f /tmp/wenmei-cd-error.$$ 2>/dev/null || true
if command -v pi >/dev/null 2>&1; then
  PI_SESSION_DIR={pi_session_dir}
  /bin/mkdir -p "$PI_SESSION_DIR" 2>/dev/null || true
  PI_PREFLIGHT="/tmp/wenmei-pi-preflight.$$"
  if ! pi --version >"$PI_PREFLIGHT" 2>&1; then
    echo 'Wenmei blocked Pi before it crashed.'
    echo ''
    echo 'Global Pi cannot start in this sandbox cwd.'
    echo 'Most likely cause: macOS privacy permission blocks Node/Pi from reading Documents/Desktop/Downloads.'
    echo ''
    echo 'Original error was saved to:'
    echo "  $LOG_FILE"
    echo ''
    log 'blocked pi: pi --version failed in sandbox'
    /bin/echo '--- pi preflight stderr ---' >> "$LOG_FILE" 2>/dev/null || true
    /bin/cat "$PI_PREFLIGHT" >> "$LOG_FILE" 2>/dev/null || true
    /bin/echo '--- end pi preflight stderr ---' >> "$LOG_FILE" 2>/dev/null || true
    /bin/rm -f "$PI_PREFLIGHT" 2>/dev/null || true
    exec ${{SHELL:-/bin/zsh}} -l
  fi
  pi_version="$(/bin/cat "$PI_PREFLIGHT" 2>/dev/null || echo unknown)"
  /bin/rm -f "$PI_PREFLIGHT" 2>/dev/null || true
  log "starting pi version=$pi_version session_dir=$PI_SESSION_DIR"
  pi --session-dir "$PI_SESSION_DIR" --continue || pi --session-dir "$PI_SESSION_DIR"
  code=$?
  log "pi exited code=$code"
else
  echo 'Pi not found. Configure global Pi first:'
  echo '  npm install -g @mariozechner/pi-coding-agent'
  log 'pi not found'
fi
echo ''
echo 'Exited Pi. Shell remains in Wenmei sandbox.'
exec ${{SHELL:-/bin/zsh}} -l
"#,
        sandbox_dir = shell_quote(&cwd.to_string_lossy()),
        log_file = shell_quote(&log_file.to_string_lossy()),
        pi_session_dir = shell_quote(&pi_session_dir.to_string_lossy())
    )
}

fn reject_unsafe_rel(path: &str) -> Result<PathBuf, String> {
    let normalized = path.trim().trim_start_matches('/');
    let rel = PathBuf::from(normalized);
    if rel.is_absolute() {
        return Err("Absolute paths are not allowed inside a vault".to_string());
    }
    for component in rel.components() {
        match component {
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                return Err("Path escapes the active vault".to_string());
            }
            _ => {}
        }
    }
    Ok(rel)
}

fn resolve_path(vault: &Vault, rel: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(&vault.path);
    Ok(root.join(reject_unsafe_rel(rel)?))
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn relative_path(full: &Path, base: &Path) -> String {
    let rel = full.strip_prefix(base).unwrap_or(full).to_string_lossy();
    let out = rel.replace('\\', "/");
    if out.is_empty() { "/".to_string() } else { out }
}

fn build_tree_recursive(dir: &Path, workspace: &Path, state: &AppState) -> Vec<FileNode> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    let mut collected: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    collected.sort_by(|a, b| {
        let a_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let b_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        match (a_dir, b_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name().cmp(&b.file_name()),
        }
    });

    let mut nodes = vec![];
    for entry in collected {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }

        let full_path = entry.path();
        let rel = relative_path(&full_path, workspace);
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let modified_at = entry.metadata().ok().and_then(|m| m.modified().ok()).map(|t| {
            let datetime: chrono::DateTime<chrono::Local> = t.into();
            datetime.format("%Y-%m-%d %H:%M").to_string()
        });

        if is_dir {
            nodes.push(FileNode {
                id: rel.clone(),
                name,
                path: rel,
                node_type: "folder".to_string(),
                children: Some(build_tree_recursive(&full_path, workspace, state)),
                is_pinned: false,
                is_recent: false,
                modified_at,
            });
        } else {
            nodes.push(FileNode {
                id: rel.clone(),
                name,
                path: rel.clone(),
                node_type: "file".to_string(),
                children: None,
                is_pinned: state.pinned_files.contains(&rel),
                is_recent: state.recent_files.contains(&rel),
                modified_at,
            });
        }
    }
    nodes
}

fn unique_child(parent: &Path, name: &str) -> PathBuf {
    let mut candidate = parent.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(name).file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let ext = Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("");
    for i in 1..1000 {
        let next = if ext.is_empty() {
            format!("{}-{}", stem, i)
        } else {
            format!("{}-{}.{}", stem, i, ext)
        };
        candidate = parent.join(next);
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!("{}-copy", name))
}

#[tauri::command]
fn list_files(state: State<'_, WenmeiState>) -> Result<Vec<FileNode>, String> {
    let vault = active_vault(&state)?;
    let workspace = PathBuf::from(&vault.path);
    let app_state = state.app_state.lock().unwrap().clone();
    Ok(build_tree_recursive(&workspace, &workspace, &app_state))
}

#[tauri::command]
fn read_file(path: String, state: State<'_, WenmeiState>) -> Result<FileContent, String> {
    let vault = active_vault(&state)?;
    let full_path = resolve_path(&vault, &path)?;
    let content = fs::read_to_string(&full_path).map_err(|e| format!("Failed to read file: {}", e))?;
    let name = full_path.file_name().and_then(|n| n.to_str()).unwrap_or("untitled").to_string();

    {
        let mut app_state = state.app_state.lock().unwrap();
        app_state.last_active_file = Some(path.clone());
        app_state.recent_files.retain(|p| p != &path);
        app_state.recent_files.insert(0, path.clone());
        app_state.recent_files.truncate(10);
    }
    save_state(&state)?;
    Ok(FileContent { path, content, name })
}

#[tauri::command]
fn write_file(path: String, content: String, app: AppHandle, state: State<'_, WenmeiState>) -> Result<(), String> {
    let vault = active_vault(&state)?;
    let full_path = resolve_path(&vault, &path)?;
    ensure_parent(&full_path)?;
    fs::write(&full_path, content).map_err(|e| format!("Failed to write file: {}", e))?;
    log_action(&state, format!("wrote {}", path));
    let _ = append_journal_event(&state, "file.updated", "file-panel", Some(path.clone()), format!("Updated {}", path), serde_json::json!({}));
    emit_files_changed(&app, "file.updated");
    save_state(&state)
}

#[tauri::command]
fn create_file(parent_path: String, name: String, app: AppHandle, state: State<'_, WenmeiState>) -> Result<String, String> {
    let vault = active_vault(&state)?;
    let parent = resolve_path(&vault, &parent_path)?;
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let full_path = unique_child(&parent, &name);
    fs::write(&full_path, "").map_err(|e| format!("Failed to create file: {}", e))?;
    let rel = relative_path(&full_path, &PathBuf::from(&vault.path));
    log_action(&state, format!("created {}", rel));
    let _ = append_journal_event(&state, "file.created", "file-panel", Some(rel.clone()), format!("Created {}", rel), serde_json::json!({}));
    emit_files_changed(&app, "file.created");
    save_state(&state)?;
    Ok(rel)
}

#[tauri::command]
fn create_folder(parent_path: String, name: String, app: AppHandle, state: State<'_, WenmeiState>) -> Result<String, String> {
    let vault = active_vault(&state)?;
    let parent = resolve_path(&vault, &parent_path)?;
    let full_path = unique_child(&parent, &name);
    fs::create_dir_all(&full_path).map_err(|e| format!("Failed to create folder: {}", e))?;
    let rel = relative_path(&full_path, &PathBuf::from(&vault.path));
    log_action(&state, format!("created folder {}", rel));
    let _ = append_journal_event(&state, "file.created", "file-panel", Some(rel.clone()), format!("Created folder {}", rel), serde_json::json!({"folder": true}));
    emit_files_changed(&app, "file.created");
    save_state(&state)?;
    Ok(rel)
}

#[tauri::command]
fn rename_file(old_path: String, new_name: String, app: AppHandle, state: State<'_, WenmeiState>) -> Result<String, String> {
    let vault = active_vault(&state)?;
    let old_full = resolve_path(&vault, &old_path)?;
    let parent = old_full.parent().ok_or_else(|| "Invalid file path".to_string())?;
    let new_full = unique_child(parent, &new_name);
    fs::rename(&old_full, &new_full).map_err(|e| format!("Failed to rename: {}", e))?;
    let rel = relative_path(&new_full, &PathBuf::from(&vault.path));
    {
        let mut app_state = state.app_state.lock().unwrap();
        if app_state.last_active_file.as_ref() == Some(&old_path) {
            app_state.last_active_file = Some(rel.clone());
        }
        app_state.pinned_files.retain(|p| p != &old_path);
        app_state.recent_files.retain(|p| p != &old_path);
    }
    log_action(&state, format!("renamed {} to {}", old_path, rel));
    let _ = append_journal_event(&state, "file.renamed", "file-panel", Some(rel.clone()), format!("Renamed {} to {}", old_path, rel), serde_json::json!({"from": old_path}));
    emit_files_changed(&app, "file.renamed");
    save_state(&state)?;
    Ok(rel)
}

#[tauri::command]
fn delete_file(path: String, app: AppHandle, state: State<'_, WenmeiState>) -> Result<(), String> {
    let vault = active_vault(&state)?;
    let full_path = resolve_path(&vault, &path)?;
    if !full_path.exists() {
        return Err("File does not exist".to_string());
    }
    let metadata_mode = state.app_state.lock().unwrap().metadata_mode.clone();
    let trash_dir = if metadata_mode == "local" {
        init_vault_meta(Path::new(&vault.path));
        PathBuf::from(&vault.path).join(".wenmei").join("trash")
    } else {
        state
            .registry_file
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("trash")
            .join(safe_meta_name(&vault.id))
    };
    fs::create_dir_all(&trash_dir).map_err(|e| e.to_string())?;
    let name = full_path.file_name().and_then(|n| n.to_str()).unwrap_or("deleted");
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let target = unique_child(&trash_dir, &format!("{}-{}", ts, name));
    fs::rename(&full_path, &target).map_err(|e| format!("Failed to move to trash: {}", e))?;
    {
        let mut app_state = state.app_state.lock().unwrap();
        if app_state.last_active_file.as_ref() == Some(&path) {
            app_state.last_active_file = None;
        }
        app_state.pinned_files.retain(|p| p != &path);
        app_state.recent_files.retain(|p| p != &path);
    }
    log_action(&state, format!("moved {} to vault trash", path));
    let _ = append_journal_event(&state, "file.deleted", "file-panel", Some(path.clone()), format!("Moved {} to vault trash", path), serde_json::json!({"trash": target.to_string_lossy()}));
    emit_files_changed(&app, "file.deleted");
    save_state(&state)
}

#[tauri::command]
fn move_file(source: String, target_folder: String, app: AppHandle, state: State<'_, WenmeiState>) -> Result<String, String> {
    let vault = active_vault(&state)?;
    let source_full = resolve_path(&vault, &source)?;
    let target_dir = resolve_path(&vault, &target_folder)?;

    if !source_full.exists() {
        return Err("Source does not exist".to_string());
    }
    let source_parent = source_full.parent().ok_or_else(|| "Invalid source".to_string())?;
    if source_parent == target_dir.as_path() {
        return Err("noop".to_string());
    }
    if source_full.is_dir() {
        let mut p: Option<&Path> = Some(target_dir.as_path());
        while let Some(cur) = p {
            if cur == source_full.as_path() {
                return Err("Cannot move folder into itself".to_string());
            }
            p = cur.parent();
        }
    }

    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let file_name = source_full.file_name().ok_or_else(|| "Invalid source".to_string())?;
    let target_full = unique_child(&target_dir, &file_name.to_string_lossy());
    fs::rename(&source_full, &target_full).map_err(|e| format!("Failed to move: {}", e))?;
    let rel = relative_path(&target_full, &PathBuf::from(&vault.path));
    log_action(&state, format!("moved {} to {}", source, rel));
    let _ = append_journal_event(&state, "file.moved", "file-panel", Some(rel.clone()), format!("Moved {} to {}", source, rel), serde_json::json!({"from": source}));
    emit_files_changed(&app, "file.moved");
    save_state(&state)?;
    Ok(rel)
}

#[tauri::command]
fn toggle_pin(path: String, state: State<'_, WenmeiState>) -> Result<bool, String> {
    let is_pinned = {
        let mut app_state = state.app_state.lock().unwrap();
        if app_state.pinned_files.contains(&path) {
            app_state.pinned_files.retain(|p| p != &path);
            false
        } else {
            app_state.pinned_files.push(path.clone());
            true
        }
    };
    log_action(&state, format!("{} {}", if is_pinned { "pinned" } else { "unpinned" }, path));
    save_state(&state)?;
    Ok(is_pinned)
}

#[tauri::command]
fn get_pinned_files(state: State<'_, WenmeiState>) -> Result<Vec<String>, String> {
    Ok(state.app_state.lock().unwrap().pinned_files.clone())
}

#[tauri::command]
fn get_recent_files(state: State<'_, WenmeiState>) -> Result<Vec<String>, String> {
    Ok(state.app_state.lock().unwrap().recent_files.clone())
}

#[tauri::command]
fn search_workspace(query: String, state: State<'_, WenmeiState>) -> Result<Vec<SearchResult>, String> {
    let vault = active_vault(&state)?;
    search_vaults(query, vec![vault])
}

#[tauri::command]
fn search_all_vaults(query: String, state: State<'_, WenmeiState>) -> Result<Vec<SearchResult>, String> {
    let registry = load_registry(&state.registry_file);
    let authorized_roots: Vec<String> = registry
        .sandboxes
        .iter()
        .flat_map(|sandbox| sandbox.roots.clone())
        .collect();
    let vaults = state
        .app_state
        .lock()
        .unwrap()
        .vaults
        .clone()
        .into_iter()
        .filter(|vault| authorized_roots.iter().any(|root| root == &vault.path))
        .collect();
    search_vaults(query, vaults)
}

fn search_vaults(query: String, vaults: Vec<Vault>) -> Result<Vec<SearchResult>, String> {
    let needle = query.to_lowercase();
    let mut results = vec![];
    if needle.trim().is_empty() {
        return Ok(results);
    }
    for vault in vaults {
        let root = PathBuf::from(&vault.path);
        for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.components().any(|c| c.as_os_str() == ".wenmei") || !path.is_file() {
                continue;
            }
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            let content = match fs::read_to_string(path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            for (i, line) in content.lines().enumerate() {
                if line.to_lowercase().contains(&needle) {
                    let snippet: String = line.chars().take(140).collect();
                    results.push(SearchResult {
                        vault_id: vault.id.clone(),
                        vault_name: vault.name.clone(),
                        path: relative_path(path, &root),
                        name: name.to_string(),
                        line_number: i + 1,
                        snippet,
                    });
                    break;
                }
            }
        }
    }
    Ok(results)
}

#[tauri::command]
fn get_app_state(state: State<'_, WenmeiState>) -> Result<AppState, String> {
    Ok(state.app_state.lock().unwrap().clone())
}

#[tauri::command]
fn save_app_state(new_state: AppState, state: State<'_, WenmeiState>) -> Result<(), String> {
    {
        let mut app_state = state.app_state.lock().unwrap();
        *app_state = new_state;
    }
    save_state(&state)
}

#[tauri::command]
fn get_workspace_path(state: State<'_, WenmeiState>) -> Result<String, String> {
    Ok(active_vault(&state)?.path)
}

/// Returns and consumes the file path provided via CLI on launch (if any).
/// Subsequent calls return None.
#[tauri::command]
fn get_initial_file(state: State<'_, WenmeiState>) -> Result<Option<String>, String> {
    Ok(state.initial_file.lock().unwrap().take())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

/// Check whether the wenmei CLI shim is available on PATH.
/// Returns the resolved path and a short version probe if found.
#[tauri::command]
fn cli_integration_status() -> CliStatus {
    let path = which::which("wenmei").ok().map(|p| p.to_string_lossy().to_string());
    let version = path.as_ref().and_then(|p| {
        let output = std::process::Command::new(p)
            .arg("--version")
            .output()
            .ok()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let text = if stdout.trim().is_empty() { stderr } else { stdout };
        let text = text.trim();
        if text.is_empty() { None } else { Some(text.to_string()) }
    });
    CliStatus {
        installed: path.is_some(),
        path,
        version,
    }
}

/// Locate a bundled script. Tauri may place resources directly under
/// Contents/Resources or under Contents/Resources/_up_/scripts when the
/// resource path uses `../`.
fn find_bundled_script(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let base = app.path().resource_dir().map_err(|e| e.to_string())?;
    let candidates = [
        base.join("_up_").join("scripts").join(name),
        base.join("scripts").join(name),
        base.join(name),
    ];
    candidates
        .iter()
        .find(|p| p.exists())
        .cloned()
        .ok_or_else(|| format!("bundled script not found: {}", name))
}

/// Install the `wenmei` CLI shim to /usr/local/bin and the macOS Finder
/// service.
///
/// Strategy:
/// 1. Try copying directly to /usr/local/bin (no sudo needed if writable).
/// 2. If that fails, fall back to osascript admin dialog.
/// 3. Always run the Finder service installer as the current user.
#[tauri::command]
fn install_cli_integration(app: AppHandle) -> Result<String, String> {
    let shim = find_bundled_script(&app, "wenmei")?;
    let finder = find_bundled_script(&app, "install-finder-service.sh")?;

    let dest = std::path::PathBuf::from("/usr/local/bin/wenmei");

    // Attempt 1: direct copy without elevated privileges
    let direct_ok = || -> Result<(), std::io::Error> {
        std::fs::create_dir_all("/usr/local/bin")?;
        std::fs::copy(&shim, &dest)?;
        let mut perms = std::fs::metadata(&dest)?.permissions();
        perms.set_readonly(false);
        std::fs::set_permissions(&dest, perms)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&dest)?.permissions();
            perms.set_mode(perms.mode() | 0o111); // add executable bits
            std::fs::set_permissions(&dest, perms)?;
        }
        Ok(())
    };

    let used_sudo = match direct_ok() {
        Ok(()) => false,
        Err(e) => {
            eprintln!("Direct install failed (will try admin dialog): {}", e);
            let shell_cmd = format!(
                "mkdir -p /usr/local/bin && cp {src} /usr/local/bin/wenmei && chmod +x /usr/local/bin/wenmei",
                src = shell_quote(&shim.to_string_lossy()),
            );
            let osa = format!(
                "do shell script \"{}\" with administrator privileges",
                shell_cmd.replace('\\', "\\\\").replace('"', "\\\"")
            );
            let cli_status = ProcessCommand::new("osascript")
                .arg("-e")
                .arg(&osa)
                .status()
                .map_err(|e| format!("osascript failed: {}", e))?;
            if !cli_status.success() {
                return Err("CLI install was cancelled or failed".into());
            }
            true
        }
    };

    let finder_status = ProcessCommand::new("bash")
        .arg(&finder)
        .status()
        .map_err(|e| format!("Finder service installer failed: {}", e))?;
    if !finder_status.success() {
        return Err("Finder service installer exited non-zero".into());
    }

    let method = if used_sudo { "via admin dialog" } else { "directly" };
    Ok(format!(
        "Installed wenmei CLI {} to /usr/local/bin and Finder service to ~/Library/Services",
        method
    ))
}

#[tauri::command]
fn set_workspace_path(new_path: String, state: State<'_, WenmeiState>) -> Result<(), String> {
    let path = PathBuf::from(&new_path);
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    init_vault_meta(&path);
    let mut registry = load_registry(&state.registry_file);
    let id = format!("vault-{}", chrono::Local::now().timestamp_millis());
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("Vault").to_string();
    let sandbox = upsert_registry_sandbox(
        &mut registry,
        "vault",
        vec![path.clone()],
        Some(name.clone()),
        "local",
        "folder-picker",
    )
    .ok_or_else(|| "Cannot authorize workspace without a root".to_string())?;
    save_registry_file(&state.registry_file, &registry)?;
    {
        let mut app_state = state.app_state.lock().unwrap();
        for vault in &mut app_state.vaults {
            vault.is_active = false;
        }
        app_state.vaults.push(Vault { id: id.clone(), name, path: new_path, is_active: true });
        app_state.active_vault_id = id.clone();
        app_state.last_active_file = None;
        app_state.open_folders = vec!["/".to_string()];
        app_state.open_mode = "vault".to_string();
        app_state.metadata_mode = "local".to_string();
        app_state.sandbox_auth_status = "promoted".to_string();
        for sandbox_state in &mut app_state.sandboxes {
            sandbox_state.is_active = false;
        }
        app_state.sandboxes.push(Sandbox {
            id: sandbox.id.clone(),
            name: "Root sandbox".to_string(),
            vault_id: id.clone(),
            root_path: "/".to_string(),
            kind: "vault".to_string(),
            is_active: true,
        });
        app_state.active_sandbox_id = Some(sandbox.id);
    }
    log_action(&state, "added and activated vault".to_string());
    save_state(&state)
}

#[tauri::command]
fn list_vaults(state: State<'_, WenmeiState>) -> Result<Vec<Vault>, String> {
    Ok(state.app_state.lock().unwrap().vaults.clone())
}

#[tauri::command]
fn add_vault(path: String, state: State<'_, WenmeiState>) -> Result<Vault, String> {
    let vault_path = PathBuf::from(&path);
    fs::create_dir_all(&vault_path).map_err(|e| e.to_string())?;
    init_vault_meta(&vault_path);
    let mut registry = load_registry(&state.registry_file);
    let id = format!("vault-{}", chrono::Local::now().timestamp_millis());
    let vault = Vault {
        id,
        name: vault_path.file_name().and_then(|n| n.to_str()).unwrap_or("Vault").to_string(),
        path,
        is_active: false,
    };
    let _ = upsert_registry_sandbox(
        &mut registry,
        "vault",
        vec![vault_path],
        Some(vault.name.clone()),
        "local",
        "folder-picker",
    );
    save_registry_file(&state.registry_file, &registry)?;
    state.app_state.lock().unwrap().vaults.push(vault.clone());
    log_action(&state, format!("joined vault {}", vault.name));
    save_state(&state)?;
    Ok(vault)
}

#[tauri::command]
fn set_active_vault(id: String, state: State<'_, WenmeiState>) -> Result<(), String> {
    let registry = load_registry(&state.registry_file);
    {
        let mut app_state = state.app_state.lock().unwrap();
        if !app_state.vaults.iter().any(|v| v.id == id) {
            return Err("Vault not found".to_string());
        }
        for vault in &mut app_state.vaults {
            vault.is_active = vault.id == id;
        }
        app_state.active_vault_id = id;
        app_state.last_active_file = None;
        app_state.open_folders = vec!["/".to_string()];
        let active_vault = active_vault_from_state(&app_state)?;
        let root = PathBuf::from(&active_vault.path);
        if let Some(auth) = registry
            .sandboxes
            .iter()
            .find(|sandbox| sandbox.primary_root == active_vault.path)
        {
            ensure_active_workspace(
                &mut app_state,
                &root,
                if auth.metadata_mode == "local" { "vault" } else { "sandbox" },
                &auth.metadata_mode,
                if auth.metadata_mode == "local" { "promoted" } else { "authorized" },
                &auth.kind,
                Some(auth.id.clone()),
            );
        } else if root.join(".wenmei").join("vault.json").exists() {
            ensure_active_workspace(
                &mut app_state,
                &root,
                "vault",
                "local",
                "promoted",
                "vault",
                None,
            );
        } else {
            ensure_active_workspace(
                &mut app_state,
                &root,
                "document",
                "global",
                "none",
                "document",
                None,
            );
        }
    }
    save_state(&state)
}

#[tauri::command]
fn list_sandboxes(state: State<'_, WenmeiState>) -> Result<Vec<Sandbox>, String> {
    Ok(state.app_state.lock().unwrap().sandboxes.clone())
}

#[tauri::command]
fn create_sandbox(name: String, root_path: String, kind: String, state: State<'_, WenmeiState>) -> Result<Sandbox, String> {
    let vault = active_vault(&state)?;
    let full_root = resolve_path(&vault, &root_path)?;
    let mut registry = load_registry(&state.registry_file);
    let registry_sandbox = upsert_registry_sandbox(
        &mut registry,
        "sandbox",
        vec![full_root],
        Some(name.clone()),
        "global",
        "app",
    )
    .ok_or_else(|| "Cannot authorize sandbox without a root".to_string())?;
    save_registry_file(&state.registry_file, &registry)?;
    let sandbox = Sandbox {
        id: registry_sandbox.id,
        name,
        vault_id: vault.id,
        root_path,
        kind,
        is_active: false,
    };
    state.app_state.lock().unwrap().sandboxes.push(sandbox.clone());
    log_action(&state, format!("created sandbox {}", sandbox.name));
    save_state(&state)?;
    Ok(sandbox)
}

#[tauri::command]
fn set_active_sandbox(id: String, state: State<'_, WenmeiState>) -> Result<(), String> {
    {
        let mut app_state = state.app_state.lock().unwrap();
        let active_vault_id = app_state.active_vault_id.clone();
        if !app_state
            .sandboxes
            .iter()
            .any(|s| s.id == id && s.vault_id == active_vault_id)
        {
            return Err("Sandbox not found".to_string());
        }
        for sandbox in &mut app_state.sandboxes {
            sandbox.is_active = sandbox.id == id && sandbox.vault_id == active_vault_id;
        }
        app_state.active_sandbox_id = Some(id);
    }
    save_state(&state)
}

#[tauri::command]
fn get_action_log(state: State<'_, WenmeiState>) -> Result<Vec<String>, String> {
    Ok(state.app_state.lock().unwrap().action_log.clone())
}

#[tauri::command]
fn get_sandbox_registry(state: State<'_, WenmeiState>) -> Result<SandboxRegistry, String> {
    Ok(load_registry(&state.registry_file))
}

#[tauri::command]
fn authorize_active_workspace(
    metadata_mode: Option<String>,
    state: State<'_, WenmeiState>,
) -> Result<AuthorizedSandbox, String> {
    let vault = active_vault(&state)?;
    let root = PathBuf::from(&vault.path);
    let metadata_mode = metadata_mode.unwrap_or_else(|| "global".to_string());
    if metadata_mode == "local" {
        init_vault_meta(&root);
    }

    let mut registry = load_registry(&state.registry_file);
    let sandbox = upsert_registry_sandbox(
        &mut registry,
        if metadata_mode == "local" { "vault" } else { "sandbox" },
        vec![root.clone()],
        Some(vault.name.clone()),
        &metadata_mode,
        if metadata_mode == "local" { "promote" } else { "app" },
    )
    .ok_or_else(|| "Cannot authorize workspace without a root".to_string())?;
    save_registry_file(&state.registry_file, &registry)?;

    {
        let mut app_state = state.app_state.lock().unwrap();
        ensure_active_workspace(
            &mut app_state,
            &root,
            if metadata_mode == "local" { "vault" } else { "sandbox" },
            &metadata_mode,
            if metadata_mode == "local" { "promoted" } else { "authorized" },
            &sandbox.kind,
            Some(sandbox.id.clone()),
        );
    }
    save_state(&state)?;
    Ok(sandbox)
}

#[tauri::command]
fn promote_active_workspace(state: State<'_, WenmeiState>) -> Result<AuthorizedSandbox, String> {
    authorize_active_workspace(Some("local".to_string()), state)
}

fn process_path() -> String {
    let defaults = [
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/Users/river/.pi/agent/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ];
    let current = std::env::var("PATH").unwrap_or_default();
    let mut parts: Vec<String> = defaults.iter().map(|s| s.to_string()).collect();
    for part in current.split(':').filter(|p| !p.is_empty()) {
        if !parts.iter().any(|existing| existing == part) {
            parts.push(part.to_string());
        }
    }
    parts.join(":")
}

fn find_pi_executable() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("WENMEI_PI_PATH") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(':').filter(|p| !p.is_empty()) {
            let candidate = PathBuf::from(dir).join("pi");
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    for candidate in [
        "/usr/local/bin/pi",
        "/opt/homebrew/bin/pi",
        "/Users/river/.pi/agent/bin/pi",
    ] {
        let path = PathBuf::from(candidate);
        if path.exists() {
            return Ok(path);
        }
    }

    Err("Global Pi executable not found. Expected /usr/local/bin/pi or /opt/homebrew/bin/pi. Install/configure Pi globally first.".to_string())
}

fn emit_pi_rpc_line(app: &AppHandle, line: &str) {
    if line.trim().is_empty() {
        return;
    }
    let event = serde_json::from_str::<serde_json::Value>(line).unwrap_or_else(|_| {
        serde_json::json!({
            "type": "client_error",
            "message": format!("Invalid Pi RPC JSON: {}", line)
        })
    });
    let _ = app.emit("pi-rpc-event", PiRpcEvent { event });
}

#[tauri::command]
fn pi_panel_start(app: AppHandle, state: State<'_, WenmeiState>, thinking: Option<String>) -> Result<PiPanelStarted, String> {
    if let Some(session) = state.pi_rpc.lock().unwrap().as_ref() {
        return Ok(PiPanelStarted {
            cwd: session.cwd.clone(),
            session_dir: session.session_dir.clone(),
            reused: true,
            thinking: session.thinking.clone(),
        });
    }

    let ctx = active_terminal_context(&state)?;
    let cwd = ctx.cwd.clone();
    fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
    let session_dir = panel_pi_session_dir(&ctx);
    fs::create_dir_all(&session_dir).map_err(|e| e.to_string())?;

    let pi_executable = find_pi_executable()?;
    let mut args = vec![
        "--mode".to_string(),
        "rpc".to_string(),
        "--session-dir".to_string(),
        session_dir.to_string_lossy().to_string(),
        "--continue".to_string(),
    ];
    if let Some(level) = thinking.as_ref().filter(|s| !s.trim().is_empty() && *s != "global") {
        args.push("--thinking".to_string());
        args.push(level.clone());
    }
    let mut child = ProcessCommand::new(&pi_executable)
        .args(args)
        .current_dir(&cwd)
        .env("PATH", process_path())
        .env("LANG", std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string()))
        .env("LC_CTYPE", std::env::var("LC_CTYPE").unwrap_or_else(|_| "UTF-8".to_string()))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start global Pi RPC at {}: {}", pi_executable.to_string_lossy(), e))?;

    let stdin = child.stdin.take().ok_or_else(|| "Pi RPC stdin unavailable".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "Pi RPC stdout unavailable".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "Pi RPC stderr unavailable".to_string())?;

    let child = Arc::new(Mutex::new(child));
    {
        let mut current = state.pi_rpc.lock().unwrap();
        *current = Some(PiRpcSession {
            writer: Arc::new(Mutex::new(stdin)),
            child,
            cwd: cwd.to_string_lossy().to_string(),
            session_dir: session_dir.to_string_lossy().to_string(),
            thinking: thinking.clone().filter(|s| s != "global"),
        });
    }

    let app_stdout = app.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) => break,
                Ok(_) => {
                    if buf.ends_with(b"\n") {
                        buf.pop();
                    }
                    if buf.ends_with(b"\r") {
                        buf.pop();
                    }
                    let line = String::from_utf8_lossy(&buf);
                    emit_pi_rpc_line(&app_stdout, &line);
                }
                Err(e) => {
                    let _ = app_stdout.emit("pi-rpc-event", PiRpcEvent {
                        event: serde_json::json!({"type":"client_error","message": format!("Pi RPC stdout read failed: {}", e)}),
                    });
                    break;
                }
            }
        }
    });

    let app_stderr = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            let _ = app_stderr.emit("pi-rpc-event", PiRpcEvent {
                event: serde_json::json!({"type":"stderr","message": line}),
            });
        }
    });

    log_action(&state, format!("started Pi Panel RPC at {} (session: {})", cwd.to_string_lossy(), session_dir.to_string_lossy()));
    let _ = save_state(&state);

    Ok(PiPanelStarted {
        cwd: cwd.to_string_lossy().to_string(),
        session_dir: session_dir.to_string_lossy().to_string(),
        reused: false,
        thinking: thinking.filter(|s| s != "global"),
    })
}

#[tauri::command]
fn pi_panel_prompt(state: State<'_, WenmeiState>, id: String, message: String) -> Result<(), String> {
    let _ = append_journal_event(&state, "pi.prompt", "pi-panel", None, message.chars().take(120).collect(), serde_json::json!({"id": id}));
    let current = state.pi_rpc.lock().unwrap();
    let session = current.as_ref().ok_or_else(|| "Pi Panel RPC is not running".to_string())?;
    let payload = serde_json::json!({
        "id": id,
        "type": "prompt",
        "message": message,
        "streamingBehavior": "followUp"
    });
    let mut writer = session.writer.lock().unwrap();
    writer.write_all(payload.to_string().as_bytes()).map_err(|e| e.to_string())?;
    writer.write_all(b"\n").map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn pi_panel_restart(app: AppHandle, state: State<'_, WenmeiState>, thinking: Option<String>) -> Result<PiPanelStarted, String> {
    let _ = pi_panel_stop(state.clone());
    pi_panel_start(app, state, thinking)
}

#[tauri::command]
fn pi_panel_abort(state: State<'_, WenmeiState>) -> Result<(), String> {
    let current = state.pi_rpc.lock().unwrap();
    let session = current.as_ref().ok_or_else(|| "Pi Panel RPC is not running".to_string())?;
    let mut writer = session.writer.lock().unwrap();
    writer.write_all(br#"{"type":"abort"}"#).map_err(|e| e.to_string())?;
    writer.write_all(b"\n").map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn pi_panel_stop(state: State<'_, WenmeiState>) -> Result<(), String> {
    let mut current = state.pi_rpc.lock().unwrap();
    if let Some(session) = current.take() {
        let _ = session.child.lock().unwrap().kill();
    }
    Ok(())
}

#[tauri::command]
fn terminal_start(
    app: AppHandle,
    state: State<'_, WenmeiState>,
    rows: u16,
    cols: u16,
) -> Result<TerminalStarted, String> {
    if let Some(session) = state.terminal.lock().unwrap().as_ref() {
        let _ = session.master.lock().unwrap().resize(PtySize {
            rows: rows.max(8),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        });
        return Ok(TerminalStarted {
            cwd: session.cwd.clone(),
            log_file: session.log_file.clone(),
            reused: true,
            snapshot: session.backlog.lock().unwrap().clone(),
        });
    }

    let ctx = active_terminal_context(&state)?;
    let cwd = ctx.cwd.clone();
    fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
    let log_file = terminal_log_file(&ctx);
    let pi_session_dir = terminal_pi_session_dir(&ctx);
    if let Some(parent) = log_file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&pi_session_dir).map_err(|e| e.to_string())?;

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(8),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let boot_script = terminal_boot_script(&cwd, &log_file, &pi_session_dir);
    let mut cmd = CommandBuilder::new(shell);
    cmd.arg("-l");
    cmd.arg("-c");
    cmd.arg(boot_script);
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("LANG", std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string()));
    cmd.env("LC_CTYPE", std::env::var("LC_CTYPE").unwrap_or_else(|_| "UTF-8".to_string()));

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let master: Arc<Mutex<Box<dyn MasterPty + Send>>> = Arc::new(Mutex::new(pair.master));
    let child = Arc::new(Mutex::new(child));
    let backlog = Arc::new(Mutex::new(Vec::<u8>::new()));
    let cwd_for_session = cwd.to_string_lossy().to_string();
    let log_file_for_session = log_file.to_string_lossy().to_string();

    {
        let mut current = state.terminal.lock().unwrap();
        *current = Some(TerminalSession {
            writer: Arc::new(Mutex::new(writer)),
            child,
            master: master.clone(),
            cwd: cwd_for_session.clone(),
            log_file: log_file_for_session.clone(),
            backlog: backlog.clone(),
        });
    }

    let app_for_read = app.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    if let Ok(mut stored) = backlog.lock() {
                        stored.extend_from_slice(&data);
                        let max = 2 * 1024 * 1024;
                        if stored.len() > max {
                            let drain_to = stored.len() - max;
                            stored.drain(0..drain_to);
                        }
                    }
                    let _ = app_for_read.emit("terminal-output", TerminalOutput { data });
                }
                Err(e) => {
                    let _ = app_for_read.emit(
                        "terminal-output",
                        TerminalOutput {
                            data: format!("\r\n[Wenmei terminal read error: {}]\r\n", e).into_bytes(),
                        },
                    );
                    break;
                }
            }
        }
    });


    log_action(&state, format!("opened embedded terminal at {} (log: {})", cwd.to_string_lossy(), log_file.to_string_lossy()));
    let _ = append_journal_event(&state, "terminal.started", "terminal", None, format!("Terminal started at {}", cwd.to_string_lossy()), serde_json::json!({"log_file": log_file_for_session}));
    emit_files_changed(&app, "terminal.started");
    let _ = save_state(&state);

    Ok(TerminalStarted {
        cwd: cwd_for_session,
        log_file: log_file_for_session,
        reused: false,
        snapshot: vec![],
    })
}

#[tauri::command]
fn terminal_write(state: State<'_, WenmeiState>, data: String) -> Result<(), String> {
    let current = state.terminal.lock().unwrap();
    let session = current.as_ref().ok_or_else(|| "Terminal is not running".to_string())?;
    let mut writer = session.writer.lock().unwrap();
    writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn terminal_resize(state: State<'_, WenmeiState>, rows: u16, cols: u16) -> Result<(), String> {
    let current = state.terminal.lock().unwrap();
    let session = current.as_ref().ok_or_else(|| "Terminal is not running".to_string())?;
    let master = session.master.lock().unwrap();
    master
        .resize(PtySize {
            rows: rows.max(8),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn terminal_stop(state: State<'_, WenmeiState>) -> Result<(), String> {
    let mut current = state.terminal.lock().unwrap();
    if let Some(session) = current.take() {
        let _ = session.child.lock().unwrap().kill();
    }
    Ok(())
}

#[tauri::command]
fn copy_file_path(path: String, state: State<'_, WenmeiState>) -> Result<String, String> {
    let vault = active_vault(&state)?;
    Ok(resolve_path(&vault, &path)?.to_string_lossy().to_string())
}

fn vault_file_signature(vault_path: &str) -> Vec<String> {
    let root = PathBuf::from(vault_path);
    let mut out = vec![];
    for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let rel = relative_path(path, &root);
        if rel == "/" || rel.starts_with(".wenmei") || rel.contains("/.wenmei/") {
            continue;
        }
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        if entry.file_type().is_file() {
            if let Ok(meta) = entry.metadata() {
                let modified = meta.modified().ok().and_then(|m| m.elapsed().ok()).map(|e| e.as_secs()).unwrap_or(0);
                out.push(format!("{}:{}:{}", rel, meta.len(), modified));
            }
        }
    }
    out.sort();
    out
}

fn start_file_polling(app: AppHandle) {
    thread::spawn(move || {
        let mut last_vault = String::new();
        let mut last_sig: Vec<String> = vec![];
        loop {
            thread::sleep(Duration::from_millis(1200));
            let state = app.state::<WenmeiState>();
            let vault = match active_vault(&state) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let sig = vault_file_signature(&vault.path);
            if last_vault.is_empty() {
                last_vault = vault.id;
                last_sig = sig;
                continue;
            }
            if last_vault != vault.id {
                last_vault = vault.id;
                last_sig = sig;
                emit_files_changed(&app, "vault.changed");
                continue;
            }
            if sig != last_sig {
                last_sig = sig;
                let _ = append_journal_event(
                    &state,
                    "files.changed",
                    "watcher",
                    None,
                    "Sandbox files changed".to_string(),
                    serde_json::json!({}),
                );
                emit_files_changed(&app, "watcher.changed");
            }
        }
    });
}

#[tauri::command]
fn reveal_in_folder(path: String, state: State<'_, WenmeiState>) -> Result<(), String> {
    let vault = active_vault(&state)?;
    let full = resolve_path(&vault, &path)?;
    let _parent = full.parent().unwrap_or_else(|| Path::new(&vault.path));

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .args(["-R", &full.to_string_lossy()])
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .args(["/select,", &full.to_string_lossy()])
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&_parent.to_string_lossy().to_string())
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(WenmeiState::new())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            start_file_polling(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_files,
            read_file,
            write_file,
            create_file,
            create_folder,
            rename_file,
            delete_file,
            move_file,
            toggle_pin,
            get_pinned_files,
            get_recent_files,
            search_workspace,
            search_all_vaults,
            get_app_state,
            save_app_state,
            get_workspace_path,
            set_workspace_path,
            get_initial_file,
            install_cli_integration,
            cli_integration_status,
            list_vaults,
            add_vault,
            set_active_vault,
            list_sandboxes,
            create_sandbox,
            set_active_sandbox,
            get_action_log,
            get_sandbox_registry,
            authorize_active_workspace,
            promote_active_workspace,
            append_journal,
            list_journal_events,
            pi_panel_start,
            pi_panel_prompt,
            pi_panel_abort,
            pi_panel_restart,
            pi_panel_stop,
            terminal_start,
            terminal_write,
            terminal_resize,
            terminal_stop,
            copy_file_path,
            reveal_in_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
