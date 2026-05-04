use portable_pty::{Child as PtyChild, MasterPty};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child as ProcessChild, ChildStdin};
use std::sync::{Arc, Mutex};
use crate::file_ops::resolve_path;
use tauri::State;

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
    #[serde(default)]
    pub first_run_at: Option<String>,
    #[serde(default)]
    pub onboarding_completed: bool,
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

fn default_open_mode() -> String {
    "vault".to_string()
}

fn default_metadata_mode() -> String {
    "local".to_string()
}

impl AppState {
    pub fn with_default_vault(vault_path: PathBuf) -> Self {
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
            first_run_at: Some(chrono::Utc::now().to_rfc3339()),
            onboarding_completed: false,
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
pub enum LaunchMode {
    Default,
    Document,
    Sandbox,
    Vault,
    Promote,
    Composite,
}

#[derive(Debug, Clone)]
pub struct LaunchIntent {
    pub mode: LaunchMode,
    pub root: Option<PathBuf>,
    pub initial_file: Option<PathBuf>,
    pub composite_name: Option<String>,
    pub composite_roots: Vec<PathBuf>,
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

pub fn parse_launch_intent() -> LaunchIntent {
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
        "open"
            | "edit"
            | "create"
            | "new"
            | "mkdir"
            | "sandbox"
            | "vault"
            | "promote"
            | "composite"
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

pub fn root_sandbox_id_for(vault_id: &str) -> String {
    if vault_id == "default" {
        "default-root".to_string()
    } else {
        format!("{}-root", vault_id)
    }
}

pub fn ensure_active_root_sandbox(app_state: &mut AppState, vault_id: &str) -> String {
    let existing = app_state
        .sandboxes
        .iter()
        .find(|sandbox| {
            sandbox.vault_id == vault_id && sandbox.kind == "vault" && sandbox.root_path == "/"
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

pub fn init_vault_meta(path: &Path) {
    let meta = path.join(".wenmei");
    let _ = fs::create_dir_all(meta.join("terminal").join("logs"));
    let _ = fs::create_dir_all(
        meta.join("pi-sessions")
            .join("default-root")
            .join("terminal"),
    );
    let _ = fs::create_dir_all(meta.join("pi-sessions").join("default-root").join("panel"));
    let _ = fs::create_dir_all(meta.join("trash"));
    let vault_json = meta.join("vault.json");
    if !vault_json.exists() {
        let raw = serde_json::json!({
            "version": 1,
            "created_at": chrono::Utc::now().to_rfc3339(),
            "default_sandbox_id": "default-root"
        });
        let _ = fs::write(
            vault_json,
            serde_json::to_string_pretty(&raw).unwrap_or_default(),
        );
    }
    let journal = meta.join("journal.jsonl");
    if !journal.exists() {
        let _ = fs::write(journal, "");
    }
}

pub fn load_registry(path: &Path) -> SandboxRegistry {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<SandboxRegistry>(&raw).ok())
        .unwrap_or_default()
}

pub fn save_registry_file(path: &Path, registry: &SandboxRegistry) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(registry).map_err(|e| e.to_string())?;
    atomic_write_json(path, &raw)
}

pub fn root_display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Wenmei")
        .to_string()
}

pub fn registry_id_for(prefix: &str) -> String {
    format!("{}-{}", prefix, chrono::Local::now().timestamp_millis())
}

pub fn upsert_registry_sandbox(
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
        id: registry_id_for(if kind == "composite" {
            "composite"
        } else {
            "sandbox"
        }),
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

pub fn record_recent_document(registry: &mut SandboxRegistry, file: &Path, root: &Path) {
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

pub fn ensure_active_workspace(
    app_state: &mut AppState,
    root: &Path,
    open_mode: &str,
    metadata_mode: &str,
    auth_status: &str,
    sandbox_kind: &str,
    sandbox_id: Option<String>,
) {
    let root_str = root.to_string_lossy().to_string();
    let vault_id = if let Some(existing) = app_state
        .vaults
        .iter()
        .find(|v| v.path == root_str)
        .cloned()
    {
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

        let config_dir = config_dir();
        fs::create_dir_all(&config_dir).unwrap_or_default();
        let state_file = config_dir.join("state.json");
        let registry_file = config_dir.join("sandboxes.json");
        let mut registry = load_registry(&registry_file);

        let mut loaded = fs::read_to_string(&state_file)
            .ok()
            .and_then(|raw| serde_json::from_str::<AppState>(&raw).ok())
            .unwrap_or_else(|| AppState::with_default_vault(fallback_vault.clone()));
        if loaded.first_run_at.is_none() {
            loaded.first_run_at = Some(chrono::Utc::now().to_rfc3339());
        }

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
            let (open_mode, metadata_mode, auth_status, sandbox_kind, auth_source) =
                match launch.mode {
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

pub fn active_vault_from_state(app_state: &AppState) -> Result<Vault, String> {
    app_state
        .vaults
        .iter()
        .find(|v| v.id == app_state.active_vault_id)
        .cloned()
        .or_else(|| app_state.vaults.first().cloned())
        .ok_or_else(|| "No vault configured".to_string())
}

pub fn config_dir() -> PathBuf {
    let fallback = dirs::document_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Wenmei")
        .join(".wenmei");
    dirs::config_dir().unwrap_or(fallback).join("Wenmei")
}

pub fn atomic_write_json(path: &Path, raw: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    {
        let mut file =
            fs::File::create(&tmp).map_err(|e| format!("Failed to create tmp: {}", e))?;
        file.write_all(raw.as_bytes())
            .map_err(|e| format!("Failed to write tmp: {}", e))?;
        file.sync_all()
            .map_err(|e| format!("Failed to fsync tmp: {}", e))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("Failed to rename tmp: {}", e))?;
    Ok(())
}

pub fn save_state(state: &State<'_, WenmeiState>) -> Result<(), String> {
    let app_state = state.app_state.lock().unwrap().clone();
    let raw = serde_json::to_string_pretty(&app_state).map_err(|e| e.to_string())?;
    atomic_write_json(&state.state_file, &raw)
}

pub fn log_action(state: &State<'_, WenmeiState>, text: String) {
    let mut app_state = state.app_state.lock().unwrap();
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    app_state.action_log.insert(0, format!("{} — {}", ts, text));
    app_state.action_log.truncate(200);
}

pub fn active_vault(state: &State<'_, WenmeiState>) -> Result<Vault, String> {
    let app_state = state.app_state.lock().unwrap();
    active_vault_from_state(&app_state)
}

pub struct TerminalContext {
    pub cwd: PathBuf,
    pub meta_root: PathBuf,
    pub sandbox_id: String,
}

pub fn safe_meta_name(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

pub fn active_terminal_context(state: &State<'_, WenmeiState>) -> Result<TerminalContext, String> {
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

pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn terminal_log_file(ctx: &TerminalContext) -> PathBuf {
    ctx.meta_root
        .join("terminal")
        .join("logs")
        .join(format!("{}.log", ctx.sandbox_id))
}

pub fn terminal_pi_session_dir(ctx: &TerminalContext) -> PathBuf {
    ctx.meta_root
        .join("pi-sessions")
        .join(&ctx.sandbox_id)
        .join("terminal")
}

pub fn panel_pi_session_dir(ctx: &TerminalContext) -> PathBuf {
    ctx.meta_root
        .join("pi-sessions")
        .join(&ctx.sandbox_id)
        .join("panel")
}

pub fn context_switch_requires_reset(surface: &str, current: &str, next: &str) -> String {
    format!(
        "[ERR_CONTEXT_SWITCH_REQUIRES_RESET] {} is already running in {}. Reset it to start in the focused sandbox at {}.",
        surface, current, next
    )
}

pub fn relative_path(full: &Path, base: &Path) -> String {
    let rel = full.strip_prefix(base).unwrap_or(full).to_string_lossy();
    let out = rel.replace('\\', "/");
    if out.is_empty() {
        "/".to_string()
    } else {
        out
    }
}

#[tauri::command]
pub fn get_app_state(state: State<'_, WenmeiState>) -> Result<AppState, String> {
    Ok(state.app_state.lock().unwrap().clone())
}

#[tauri::command]
pub fn save_app_state(new_state: AppState, state: State<'_, WenmeiState>) -> Result<(), String> {
    {
        let mut app_state = state.app_state.lock().unwrap();
        let mut next_state = new_state;
        if next_state.first_run_at.is_none() {
            next_state.first_run_at = app_state.first_run_at.clone();
        }
        next_state.onboarding_completed =
            app_state.onboarding_completed || next_state.onboarding_completed;
        *app_state = next_state;
    }
    save_state(&state)
}

#[tauri::command]
pub fn get_workspace_path(state: State<'_, WenmeiState>) -> Result<String, String> {
    Ok(active_vault(&state)?.path)
}

#[tauri::command]
pub fn get_initial_file(state: State<'_, WenmeiState>) -> Result<Option<String>, String> {
    Ok(state.initial_file.lock().unwrap().take())
}
