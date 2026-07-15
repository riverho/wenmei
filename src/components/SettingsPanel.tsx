import { useEffect, useRef, useState } from "react";
import { useAppStore, DEFAULT_KEYMAP } from "@/store/appStore";
import {
  checkForUpdate,
  cliIntegrationStatus,
  installCliIntegration,
  runInstallScript,
  readFile,
  listVaults,
  addVault,
  removeVault,
  openFolderDialog,
  clearReviewStaging,
  trashSize,
  emptyTrash,
} from "@/lib/tauri-bridge";
import {
  Loader2,
  Settings,
  Monitor,
  Moon,
  Sun,
  Terminal,
  Square,
  Keyboard,
  Bot,
  Link2,
  Key,
  Info,
  Plus,
  Minus,
  Check,
  ExternalLink,
  Copy,
  FolderOpen,
  Trash2,
  Menu,
  X,
  HeartPulse,
  HeartOff,
  SquarePen,
  RotateCcw,
} from "lucide-react";
import { DEFAULT_NARRATION_PROMPT } from "@/lib/narration-prompt";

// ─── Toggle component ─────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
  description?: string;
}) {
  return (
    <label
      className={`flex items-start gap-3 cursor-pointer select-none ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <div
        className="mt-0.5 shrink-0"
        onClick={e => {
          e.preventDefault();
          if (!disabled) onChange(!checked);
        }}
      >
        <div
          className="w-8 h-4 rounded-full transition-all duration-200 flex items-center"
          style={{
            background: checked ? "var(--accent-teal)" : "var(--surface-3)",
            justifyContent: checked ? "flex-end" : "flex-start",
            padding: "2px",
          }}
        >
          <div
            className="w-3 h-3 rounded-full transition-all duration-200"
            style={{
              background: "#fff",
              boxShadow: checked ? "0 0 4px rgba(0,134,115,0.5)" : "none",
            }}
          />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div
          className="text-xs font-medium"
          style={{ color: "var(--text-primary)" }}
        >
          {label}
        </div>
        {description && (
          <div
            className="text-[10px] mt-0.5 leading-relaxed"
            style={{ color: "var(--text-tertiary)" }}
          >
            {description}
          </div>
        )}
      </div>
    </label>
  );
}

function ControlPlaneRow() {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    readFile(".wenmei/wenmei-control.json")
      .then(file => {
        if (cancelled) return;
        try {
          const data = JSON.parse(file.content) as { token?: string };
          setToken(data.token ?? null);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCopy() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const status = token
    ? "Running on 127.0.0.1"
    : error
      ? "Not running"
      : "Checking…";

  const statusColor = token
    ? "var(--accent-teal)"
    : error
      ? "var(--accent-rose)"
      : "var(--text-tertiary)";

  return (
    <SettingRow
      label="Control plane"
      description={
        error && !token
          ? "Start the app to enable the local JSON-RPC server"
          : token
            ? `Token: ${token.slice(0, 12)}… — Local JSON-RPC for external agents`
            : status
      }
    >
      <div className="flex items-center gap-2">
        <span
          className="flex items-center gap-1 text-xs px-2 py-1 rounded"
          style={{
            background: token ? "rgba(0, 134, 115, 0.1)" : "var(--surface-2)",
            color: statusColor,
          }}
        >
          {token ? (
            <Check size={10} />
          ) : (
            <Loader2 size={10} className={error ? "" : "animate-spin"} />
          )}
          {token ? "Running" : status}
        </span>
        {token && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors"
            style={{
              color: copied ? "var(--accent-teal)" : "var(--text-tertiary)",
            }}
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? "Copied" : "Copy token"}
          </button>
        )}
      </div>
    </SettingRow>
  );
}

// ─── Section heading ────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  id,
  children,
}: {
  icon: React.ElementType;
  title: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id ? `settings-${id}` : undefined}
      data-settings-section={id}
      className="space-y-3 scroll-mt-4"
    >
      <div className="flex items-center gap-2">
        <Icon size={13} style={{ color: "var(--accent-teal)" }} />
        <h2
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-secondary)" }}
        >
          {title}
        </h2>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

// ─── Vaults section — multi-select soft-remove via backend ────────────────────

function VaultsSection() {
  const vaults = useAppStore(s => s.vaults);
  const activeVaultId = useAppStore(s => s.activeVaultId);
  const setVaults = useAppStore(s => s.setVaults);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [trashBytes, setTrashBytes] = useState<number | null>(null);

  useEffect(() => {
    trashSize()
      .then(setTrashBytes)
      .catch(() => setTrashBytes(null));
  }, [activeVaultId]);

  const removable = vaults.filter(v => v.id !== activeVaultId);
  const allSelected =
    removable.length > 0 && removable.every(v => selected.has(v.id));

  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(removable.map(v => v.id)));

  async function handleAdd() {
    const path = await openFolderDialog();
    if (!path) return;
    setBusy(true);
    try {
      await addVault(path);
      setVaults(await listVaults());
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveSelected() {
    setBusy(true);
    try {
      for (const id of selected) {
        if (id !== activeVaultId) await removeVault(id);
      }
      setVaults(await listVaults());
      setSelected(new Set());
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section icon={FolderOpen} title="Vaults" id="vaults">
      <div className="flex items-center justify-between gap-2">
        <label
          className="flex items-center gap-2 text-[11px] cursor-pointer select-none"
          style={{ color: "var(--text-secondary)" }}
        >
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="accent-[var(--accent-teal)]"
          />
          Select all
        </label>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleAdd}
            disabled={busy}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded font-medium disabled:opacity-50"
            style={{ background: "var(--accent-teal)", color: "#fff" }}
          >
            <Plus size={10} />
            Add folder
          </button>
          <button
            onClick={handleRemoveSelected}
            disabled={selected.size === 0 || busy}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded font-medium disabled:opacity-40"
            style={{ background: "var(--accent-rose)", color: "#fff" }}
          >
            <Trash2 size={10} />
            Remove {selected.size > 0 ? `(${selected.size})` : ""}
          </button>
        </div>
      </div>

      <div
        className="rounded-lg overflow-hidden"
        style={{ border: "1px solid var(--surface-3)" }}
      >
        {vaults.map(vault => {
          const isActive = vault.id === activeVaultId;
          return (
            <label
              key={vault.id}
              className={`flex items-center gap-2.5 px-3 py-2 select-none ${
                isActive ? "cursor-default" : "cursor-pointer"
              }`}
              style={{
                borderBottom: "1px solid var(--surface-3)",
                background: selected.has(vault.id)
                  ? "rgba(194, 74, 74, 0.05)"
                  : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(vault.id)}
                onChange={() => toggle(vault.id)}
                disabled={isActive}
                className="accent-[var(--accent-teal)] disabled:opacity-30"
              />
              <div className="min-w-0 flex-1">
                <div
                  className="text-xs font-medium truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {vault.name}
                </div>
                <div
                  className="text-[10px] truncate"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {vault.path}
                </div>
              </div>
              {isActive && (
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={{
                    background: "rgba(0, 134, 115, 0.1)",
                    color: "var(--accent-teal)",
                  }}
                >
                  Active
                </span>
              )}
            </label>
          );
        })}
      </div>

      <p
        className="text-[10px] leading-relaxed"
        style={{ color: "var(--text-tertiary)" }}
      >
        Removing a vault only detaches the folder from Wenmei's list — a soft
        boundary in state.json. Files on disk are never touched, so there is
        nothing to archive; add the folder back anytime.
      </p>

      <div className="flex items-center gap-2">
        <button
          onClick={async () => {
            if (
              window.confirm(
                "Clear all review staging baselines for the active vault? This does not affect your files."
              )
            ) {
              try {
                await clearReviewStaging();
              } catch (err) {
                window.alert(err instanceof Error ? err.message : String(err));
              }
            }
          }}
          disabled={busy}
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded font-medium disabled:opacity-40"
          style={{
            background: "var(--surface-2)",
            color: "var(--text-secondary)",
          }}
        >
          <Trash2 size={10} />
          Clear review staging
        </button>
        <button
          onClick={async () => {
            if (
              window.confirm(
                "Permanently empty the vault trash? Files moved to trash by deletes cannot be recovered after this."
              )
            ) {
              setBusy(true);
              try {
                await emptyTrash();
                setTrashBytes(await trashSize());
              } catch (err) {
                window.alert(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }
          }}
          disabled={busy || !trashBytes}
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded font-medium disabled:opacity-40"
          style={{
            background: "var(--surface-2)",
            color: "var(--text-secondary)",
          }}
        >
          <Trash2 size={10} />
          Empty trash
          {trashBytes ? ` (${(trashBytes / (1024 * 1024)).toFixed(1)} MB)` : ""}
        </button>
      </div>
    </Section>
  );
}

// ─── Two-column shell: section nav rail + scroll-spy (responsive) ─────────────

const SETTINGS_NAV: { id: string; label: string; icon: React.ElementType }[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "vaults", label: "Vaults", icon: FolderOpen },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "windows", label: "Windows", icon: Square },
  { id: "keyboard", label: "Keyboard", icon: Keyboard },
  { id: "agent", label: "Agent & Narration", icon: Bot },
  { id: "heartbeat", label: "Heartbeat", icon: HeartPulse },
  { id: "integrations", label: "Integrations", icon: Link2 },
  { id: "license", label: "License", icon: Key },
  { id: "about", label: "About", icon: Info },
];

function SettingsNav({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="flex flex-col gap-0.5 px-2 py-3">
      {SETTINGS_NAV.map(({ id, label, icon: Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors text-left"
            style={{
              background: isActive ? "var(--surface-2)" : "transparent",
              color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
              fontWeight: isActive ? 600 : 400,
            }}
          >
            <Icon
              size={13}
              className="shrink-0"
              style={{
                color: isActive ? "var(--accent-teal)" : "var(--text-tertiary)",
              }}
            />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function MobileSettingsNav({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeLabel =
    SETTINGS_NAV.find(({ id }) => id === active)?.label ?? "Settings";

  return (
    <div className="relative">
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ background: "var(--surface-1)" }}
      >
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2 text-xs font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          {open ? <X size={14} /> : <Menu size={14} />}
          <span>{open ? "Close" : "Menu"}</span>
        </button>
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          {activeLabel}
        </span>
      </div>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            style={{ background: "rgba(0, 0, 0, 0.2)" }}
            onClick={() => setOpen(false)}
          />
          <nav
            className="absolute top-full left-0 right-0 z-50 px-2 py-2 border-b"
            style={{
              background: "var(--surface-1)",
              borderColor: "var(--surface-3)",
            }}
          >
            {SETTINGS_NAV.map(({ id, label, icon: Icon }) => {
              const isActive = active === id;
              return (
                <button
                  key={id}
                  onClick={() => {
                    setOpen(false);
                    onSelect(id);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs whitespace-nowrap transition-colors text-left"
                  style={{
                    background: isActive ? "var(--surface-2)" : "transparent",
                    color: isActive
                      ? "var(--text-primary)"
                      : "var(--text-secondary)",
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  <Icon
                    size={13}
                    className="shrink-0"
                    style={{
                      color: isActive
                        ? "var(--accent-teal)"
                        : "var(--text-tertiary)",
                    }}
                  />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>
        </>
      )}
    </div>
  );
}

// ─── Divider ─────────────────────────────────────────────────────────────────

function Divider() {
  return <div className="h-px" style={{ background: "var(--surface-3)" }} />;
}

// ─── Settings rows ────────────────────────────────────────────────────────────

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div
          className="text-xs font-medium"
          style={{ color: "var(--text-primary)" }}
        >
          {label}
        </div>
        {description && (
          <div
            className="text-[10px] mt-0.5 leading-relaxed"
            style={{ color: "var(--text-tertiary)" }}
          >
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ─── Theme selector ──────────────────────────────────────────────────────────

function ThemeSelector() {
  const { theme, setTheme } = useAppStore();
  const options = [
    { key: "system" as const, label: "System", icon: Monitor },
    { key: "light" as const, label: "Light", icon: Sun },
    { key: "dark" as const, label: "Dark", icon: Moon },
  ];
  return (
    <div className="flex items-center gap-1">
      {options.map(({ key, label, icon: Icon }) => {
        const active = theme === key;
        return (
          <button
            key={key}
            onClick={() => setTheme(key)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
            style={{
              background: active ? "var(--accent-teal)" : "var(--surface-2)",
              color: active ? "#fff" : "var(--text-secondary)",
              border: active ? "none" : "1px solid var(--surface-3)",
            }}
            title={`${label} theme`}
          >
            <Icon size={12} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Tab limit stepper ──────────────────────────────────────────────────────

function Stepper({
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="flex items-center justify-center w-6 h-6 rounded border disabled:opacity-40 transition-colors"
        style={{
          background: "var(--surface-2)",
          borderColor: "var(--surface-3)",
          color: "var(--text-secondary)",
        }}
      >
        <Minus size={10} />
      </button>
      <span
        className="text-xs font-mono min-w-[2ch] text-center"
        style={{ color: "var(--text-primary)" }}
      >
        {value}
        {suffix}
      </span>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="flex items-center justify-center w-6 h-6 rounded border disabled:opacity-40 transition-colors"
        style={{
          background: "var(--surface-2)",
          borderColor: "var(--surface-3)",
          color: "var(--text-secondary)",
        }}
      >
        <Plus size={10} />
      </button>
    </div>
  );
}

// ─── Heartbeat toggle — bespoke heart icon, not the generic rocker. Red +
// double-thump animation when on; grey crossed-out heart when off. ──────────

function HeartbeatToggleButton({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
      style={{
        background: enabled ? "rgba(194, 74, 74, 0.08)" : "var(--surface-2)",
        border: `1px solid ${enabled ? "var(--accent-rose)" : "var(--surface-3)"}`,
        color: enabled ? "var(--accent-rose)" : "var(--text-tertiary)",
      }}
      title={
        enabled
          ? "Heartbeat is on — click to turn off"
          : "Heartbeat is off — click to turn on"
      }
    >
      {enabled ? (
        <HeartPulse size={15} className="animate-heartbeat" />
      ) : (
        <HeartOff size={15} />
      )}
      {enabled ? "On" : "Off"}
    </button>
  );
}

// ─── Heartbeat interval — three presets plus an open field for any value ────

const HEARTBEAT_PRESETS = [5, 15, 30];

function HeartbeatIntervalSelector({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (minutes: number) => void;
  disabled?: boolean;
}) {
  const isPreset = HEARTBEAT_PRESETS.includes(value);
  const [customDraft, setCustomDraft] = useState(isPreset ? "" : String(value));

  function commitCustom() {
    const n = parseInt(customDraft, 10);
    if (Number.isFinite(n) && n > 0) onChange(n);
  }

  return (
    <div
      className={`flex items-center gap-1.5 ${disabled ? "opacity-40 pointer-events-none" : ""}`}
    >
      {HEARTBEAT_PRESETS.map(minutes => {
        const active = value === minutes;
        return (
          <button
            key={minutes}
            onClick={() => {
              setCustomDraft("");
              onChange(minutes);
            }}
            className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-150"
            style={{
              background: active ? "var(--accent-teal)" : "var(--surface-2)",
              color: active ? "#fff" : "var(--text-secondary)",
              border: active ? "none" : "1px solid var(--surface-3)",
            }}
          >
            {minutes}m
          </button>
        );
      })}
      <div
        className="flex items-center gap-1 pl-2 rounded-lg transition-all duration-150"
        style={{
          background: !isPreset ? "var(--accent-teal)" : "var(--surface-2)",
          border: !isPreset ? "none" : "1px solid var(--surface-3)",
        }}
      >
        <input
          type="number"
          min={1}
          placeholder="Custom"
          value={customDraft}
          onChange={e => setCustomDraft(e.target.value)}
          onBlur={commitCustom}
          onKeyDown={e => {
            if (e.key === "Enter") {
              commitCustom();
              e.currentTarget.blur();
            }
          }}
          className="w-12 bg-transparent outline-none text-xs font-mono text-center py-1"
          style={{ color: !isPreset ? "#fff" : "var(--text-primary)" }}
        />
        <span
          className="text-[10px] pr-2"
          style={{ color: !isPreset ? "#fff" : "var(--text-tertiary)" }}
        >
          min
        </span>
      </div>
    </div>
  );
}

// ─── Key hint ────────────────────────────────────────────────────────────────

function KeyHint({ chord }: { chord: string }) {
  const isMac = useAppStore(s => s.platform) === "macos";
  const keys = chord.split("+").map(k => {
    const lower = k.toLowerCase();
    if (lower === "mod") return isMac ? "⌘" : "Ctrl";
    if (lower === "meta" || lower === "cmdorctrl") return "⌘";
    if (lower === "ctrl" || lower === "control") return isMac ? "⌃" : "Ctrl";
    if (lower === "shift") return "⇧";
    if (lower === "alt") return "⌥";
    if (lower === "arrowup") return "↑";
    if (lower === "arrowdown") return "↓";
    if (lower === "arrowleft") return "←";
    if (lower === "arrowright") return "→";
    if (lower === "escape") return "Esc";
    if (lower === "backspace") return "⌫";
    if (lower === "enter") return "↵";
    if (lower === "tab") return "⇥";
    if (lower === "space") return "Space";
    if (lower === "`") return "`";
    return k.toUpperCase();
  });

  return (
    <div className="flex items-center gap-0.5">
      {keys.map((k, i) => (
        <span key={i}>
          <kbd
            className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-mono rounded border"
            style={{
              background: "var(--surface-2)",
              borderColor: "var(--surface-3)",
              color: "var(--text-secondary)",
              minWidth: i > 0 ? undefined : "18px",
            }}
          >
            {k}
          </kbd>
          {i < keys.length - 1 && (
            <span
              className="text-[8px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              +
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

// ─── Keymap labels ──────────────────────────────────────────────────────────
// Action keys mirror DEFAULT_KEYMAP in appStore.ts exactly — the displayed
// chord is read live from the keymap store, not derived from row position.

const SHORTCUT_LABELS: { action: string; label: string }[] = [
  { action: "toggleLeftPanel", label: "Toggle left panel" },
  { action: "toggleTerminalMode", label: "Toggle terminal mode" },
  { action: "focusPi", label: "Toggle right panel / focus Pi" },
  { action: "editMode", label: "Edit mode" },
  { action: "previewMode", label: "Preview mode" },
  { action: "splitMode", label: "Split view" },
  { action: "togglePaper", label: "Paper mode" },
  { action: "toggleTerminal", label: "Toggle terminal (alt binding)" },
  { action: "focusSearch", label: "Search files" },
  { action: "commandPalette", label: "Command palette (opens Pi)" },
  { action: "newFile", label: "New file" },
  { action: "newFolder", label: "New folder" },
  { action: "toggleTheme", label: "Cycle theme" },
  { action: "workspaceSearch", label: "Workspace search (Pi)" },
];

// ─── Live CLI integration row (real bridge status + install) ─────────────────

function CliIntegrationRow() {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [cliPath, setCliPath] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    cliIntegrationStatus()
      .then(status => {
        if (cancelled) return;
        setInstalled(status.installed);
        setCliPath(status.path);
      })
      .catch(err => {
        if (cancelled) return;
        setInstalled(false);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleInstall() {
    if (installing) return;
    setInstalling(true);
    setError(null);
    try {
      await installCliIntegration();
      const status = await cliIntegrationStatus();
      setInstalled(status.installed);
      setCliPath(status.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  }

  return (
    <SettingRow
      label="CLI integration"
      description={error ?? cliPath ?? "The wenmei command in your terminal"}
    >
      <div className="flex items-center gap-2">
        {installed ? (
          <span
            className="flex items-center gap-1 text-xs px-2 py-1 rounded"
            style={{
              background: "rgba(0, 134, 115, 0.1)",
              color: "var(--accent-teal)",
            }}
          >
            <Check size={10} />
            Installed
          </span>
        ) : (
          <button
            onClick={handleInstall}
            disabled={installing || installed === null}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded disabled:opacity-60"
            style={{ background: "var(--accent-teal)", color: "#fff" }}
          >
            {installing ? (
              <>
                <Loader2 size={10} className="animate-spin" />
                Installing
              </>
            ) : installed === null ? (
              "Checking…"
            ) : (
              "Install"
            )}
          </button>
        )}
      </div>
    </SettingRow>
  );
}

/** Install row driven by the real runInstallScript command; status is
 *  session-local (installed-this-session) since there is no query API. */
function InstallScriptRow({
  label,
  description,
  scriptName,
}: {
  label: string;
  description: string;
  scriptName: string;
}) {
  const [state, setState] = useState<"idle" | "installing" | "done" | "error">(
    "idle"
  );
  const [message, setMessage] = useState<string | null>(null);

  async function handleInstall() {
    if (state === "installing") return;
    setState("installing");
    setMessage(null);
    try {
      const result = await runInstallScript(scriptName);
      setState("done");
      setMessage(result || null);
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <SettingRow label={label} description={message ?? description}>
      <div className="flex items-center gap-2">
        {state === "done" ? (
          <span
            className="flex items-center gap-1 text-xs px-2 py-1 rounded"
            style={{
              background: "rgba(0, 134, 115, 0.1)",
              color: "var(--accent-teal)",
            }}
          >
            <Check size={10} />
            Installed
          </span>
        ) : (
          <button
            onClick={handleInstall}
            disabled={state === "installing"}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded font-medium disabled:opacity-60"
            style={{
              background:
                state === "error" ? "var(--accent-rose)" : "var(--accent-teal)",
              color: "#fff",
            }}
          >
            {state === "installing" ? (
              <>
                <Loader2 size={10} className="animate-spin" />
                Installing
              </>
            ) : state === "error" ? (
              "Retry"
            ) : (
              "Install"
            )}
          </button>
        )}
      </div>
    </SettingRow>
  );
}

function CheckUpdateRow() {
  const [state, setState] = useState<
    "idle" | "checking" | "current" | "available" | "unconfigured"
  >("idle");
  const [version, setVersion] = useState<string | null>(null);

  async function handleCheck() {
    if (state === "checking") return;
    setState("checking");
    try {
      const next = await checkForUpdate();
      if (next) {
        setVersion(next);
        setState("available");
      } else {
        setState("current");
      }
    } catch {
      // Placeholder pubkey / offline — updates not configured yet.
      setState("unconfigured");
    }
  }

  return (
    <SettingRow
      label="Check for updates"
      description={
        state === "available"
          ? `Version ${version} is available — download from the releases page`
          : state === "current"
            ? "You're on the latest version"
            : state === "unconfigured"
              ? "Updates aren't configured for this build"
              : "Checks the release feed; nothing installs without you"
      }
    >
      <button
        onClick={handleCheck}
        disabled={state === "checking"}
        className="flex items-center gap-1 text-[10px] px-2 py-1 rounded font-medium disabled:opacity-60"
        style={{
          background:
            state === "available" ? "var(--accent-teal)" : "var(--surface-2)",
          color: state === "available" ? "#fff" : "var(--text-secondary)",
        }}
      >
        {state === "checking" ? (
          <>
            <Loader2 size={10} className="animate-spin" />
            Checking
          </>
        ) : (
          "Check now"
        )}
      </button>
    </SettingRow>
  );
}

// ─── Narration prompt editor ─────────────────────────────────────────────────
// Full-page editor for the sidecar narration harness (the instruction the
// narration agent runs with). Layered above the Settings lightbox (z-[200])
// and the sidecar detail overlay (z-[300]). Empty store value = default.

function NarrationPromptEditor({ onClose }: { onClose: () => void }) {
  const narrationPrompt = useAppStore(s => s.narrationPrompt);
  const setNarrationPrompt = useAppStore(s => s.setNarrationPrompt);
  const [draft, setDraft] = useState(() =>
    narrationPrompt.trim() ? narrationPrompt : DEFAULT_NARRATION_PROMPT
  );
  const isDefault = draft.trim() === DEFAULT_NARRATION_PROMPT;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function save() {
    const trimmed = draft.trim();
    // Store "" when the text matches the default, so future default
    // improvements reach users who never customized.
    setNarrationPrompt(trimmed === DEFAULT_NARRATION_PROMPT ? "" : trimmed);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center p-4 md:p-8"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        background: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <div
        className="flex flex-col overflow-hidden rounded-2xl shadow-2xl"
        style={{
          width: "min(760px, 94vw)",
          height: "min(560px, 88vh)",
          background: "var(--surface-1)",
          border: "1px solid var(--surface-3)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between shrink-0 px-5 py-3"
          style={{ borderBottom: "1px solid var(--surface-3)" }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Bot size={15} style={{ color: "#a78bfa" }} />
            <div className="min-w-0">
              <h2
                className="text-sm font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                Narration prompt
              </h2>
              <div
                className="text-[10px] mt-0.5"
                style={{ color: "var(--text-tertiary)" }}
              >
                The harness the sidecar agent runs with — what to watch for and
                how to narrate it
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-150 hover:-translate-y-0.5 shrink-0 ml-3"
            style={{ color: "var(--text-tertiary)" }}
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Editor */}
        <div className="flex flex-col flex-1 min-h-0 p-5 gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            autoFocus
            spellCheck={false}
            className="flex-1 min-h-0 w-full resize-none rounded-lg p-4 text-xs font-mono leading-relaxed outline-none wenmei-scroll"
            style={{
              background: "var(--surface-0)",
              border: "1px solid var(--surface-3)",
              color: "var(--text-primary)",
            }}
          />
          <div
            className="text-[10px]"
            style={{ color: "var(--text-tertiary)" }}
          >
            Terminal output, changed files, and drift flags are appended
            automatically after this prompt on every narration.
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between shrink-0 px-5 py-3"
          style={{ borderTop: "1px solid var(--surface-3)" }}
        >
          <button
            onClick={() => setDraft(DEFAULT_NARRATION_PROMPT)}
            disabled={isDefault}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "var(--surface-2)",
              color: "var(--text-secondary)",
            }}
          >
            <RotateCcw size={11} />
            Reset to default
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-[11px] font-medium transition-colors"
              style={{
                background: "var(--surface-2)",
                color: "var(--text-secondary)",
              }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={draft.trim().length === 0}
              className="px-3 py-1.5 rounded text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "var(--accent-teal)", color: "#fff" }}
            >
              Save prompt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Settings panel ───────────────────────────────────────────────────────

export default function SettingsPanel() {
  const {
    narrateByDefault,
    setNarrateByDefault,
    narrationPrompt,
    heartbeatEnabled,
    setHeartbeatEnabled,
    heartbeatIntervalMinutes,
    setHeartbeatIntervalMinutes,
    agentProcessNames,
    setAgentProcessNames,
    terminalTabLimit,
    setTerminalTabLimit,
    terminalTabsUnlimited,
    setTerminalTabsUnlimited,
    sandboxNewWindows,
    setSandboxNewWindows,
    leftPanelOpen,
    setLeftPanelOpen,
    licenseTier,
    licenseKey,
    setLicenseKey,
    platform,
    keymap,
    setKeymapBinding,
  } = useAppStore();

  const [copiedKey, setCopiedKey] = useState(false);
  const [activeSection, setActiveSection] = useState("general");
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [agentNamesDraft, setAgentNamesDraft] = useState(() =>
    agentProcessNames.join(", ")
  );
  const [recordingAction, setRecordingAction] = useState<string | null>(null);

  // Capture the next keypress while a shortcut row is being rebound. Runs in
  // the capture phase and stops propagation so it wins the race against
  // useKeyboardShortcuts' bubble-phase window listener (e.g. so recording
  // "Cmd+1" doesn't also toggle the sidebar, and Escape cancels the
  // recording instead of closing this Settings modal).
  useEffect(() => {
    if (!recordingAction) return;
    const action = recordingAction;
    function handleCapture(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      if (
        e.key === "Escape" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey
      ) {
        setRecordingAction(null);
        return;
      }
      // Bare printable keys (letters/digits/punctuation) need a modifier so
      // the binding doesn't collide with normal typing elsewhere in the app.
      const printable = e.key.length === 1;
      if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && printable) {
        return;
      }
      const parts: string[] = [];
      if (e.metaKey || e.ctrlKey) parts.push("mod");
      if (e.shiftKey) parts.push("shift");
      if (e.altKey) parts.push("alt");
      parts.push(e.key.toLowerCase());
      setKeymapBinding(action, parts.join("+"));
      setRecordingAction(null);
    }
    window.addEventListener("keydown", handleCapture, true);
    return () => window.removeEventListener("keydown", handleCapture, true);
  }, [recordingAction, setKeymapBinding]);

  function commitAgentNames() {
    const names = agentNamesDraft
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    setAgentProcessNames(names);
    setAgentNamesDraft(names.join(", "));
  }
  const scrollRef = useRef<HTMLDivElement>(null);
  const clickScrollRef = useRef(false);

  const handleCopyLicenseKey = () => {
    if (licenseKey) {
      navigator.clipboard.writeText(licenseKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const scrollToSection = (id: string) => {
    setActiveSection(id);
    clickScrollRef.current = true;
    const root = scrollRef.current;
    const el = root?.querySelector(`#settings-${id}`);
    if (root && el) {
      const top =
        el.getBoundingClientRect().top -
        root.getBoundingClientRect().top +
        root.scrollTop;
      root.scrollTo({ top, behavior: "smooth" });
    }
    window.setTimeout(() => {
      clickScrollRef.current = false;
    }, 600);
  };

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const onScroll = () => {
      if (clickScrollRef.current) return;
      const rootRect = root.getBoundingClientRect();
      let current: string | null = null;
      root
        .querySelectorAll<HTMLElement>("[data-settings-section]")
        .forEach(sec => {
          const secRect = sec.getBoundingClientRect();
          if (secRect.top - rootRect.top <= 48) {
            current = sec.dataset.settingsSection ?? current;
          }
        });
      if (current) {
        setActiveSection(prev => (prev === current ? prev : current!));
      }
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => root.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      ref={scrollRef}
      className="flex flex-col md:flex-row items-stretch h-full min-h-0 overflow-y-auto wenmei-scroll"
      style={{ background: "var(--surface-1)" }}
    >
      <aside
        className="hidden md:flex sticky top-0 self-start flex-col w-44 shrink-0 h-full max-h-full overflow-y-auto border-r"
        style={{
          borderColor: "var(--surface-3)",
          background: "var(--surface-1)",
        }}
      >
        <SettingsNav active={activeSection} onSelect={scrollToSection} />
      </aside>

      <div
        className="md:hidden sticky top-0 z-30 shrink-0"
        style={{ background: "var(--surface-1)" }}
      >
        <MobileSettingsNav active={activeSection} onSelect={scrollToSection} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="max-w-2xl px-4 py-4 md:px-6 md:py-5 space-y-6">
          {/* ── General ── */}
          <Section icon={Settings} title="General" id="general">
            <SettingRow
              label="Theme"
              description="Color scheme for the interface"
            >
              <ThemeSelector />
            </SettingRow>

            <SettingRow
              label="Left sidebar"
              description="File tree and navigation panel"
            >
              <Toggle
                checked={leftPanelOpen}
                onChange={v => setLeftPanelOpen(v)}
                label="Visible"
                description="Show or hide the left sidebar"
              />
            </SettingRow>
          </Section>

          <Divider />

          {/* ── Vaults ── */}
          <VaultsSection />

          <Divider />

          {/* ── Terminal ── */}
          <Section icon={Terminal} title="Terminal" id="terminal">
            <SettingRow
              label="Narration by default"
              description="New terminal tabs start with narration enabled"
            >
              <div className="flex flex-col items-start gap-2">
                <Toggle
                  checked={narrateByDefault}
                  onChange={v => setNarrateByDefault(v)}
                  label="Narrate by default"
                  description="When enabled, new tabs start with narration on"
                />
                <button
                  onClick={() => setPromptEditorOpen(true)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium border transition-colors hover:opacity-80"
                  style={{
                    background: "var(--surface-2)",
                    borderColor: "var(--surface-3)",
                    color: "var(--text-secondary)",
                  }}
                  title="What the sidecar agent watches for and narrates"
                >
                  <SquarePen size={10} />
                  Edit narration prompt
                  <span style={{ color: "var(--text-tertiary)" }}>
                    · {narrationPrompt.trim() ? "custom" : "default"}
                  </span>
                </button>
              </div>
            </SettingRow>

            <SettingRow
              label="Tab memory limit"
              description="Max terminal tabs before oldest are garbage-collected"
            >
              <div className="flex items-center gap-3">
                <Toggle
                  checked={terminalTabsUnlimited}
                  onChange={v => setTerminalTabsUnlimited(v)}
                  label="Unlimited"
                />
                {!terminalTabsUnlimited && (
                  <Stepper
                    value={terminalTabLimit}
                    onChange={v => setTerminalTabLimit(v)}
                    min={1}
                    max={32}
                  />
                )}
              </div>
            </SettingRow>

            <SettingRow
              label="Estimated terminal memory"
              description="Based on PTY scrollback + xterm buffer allocation"
            >
              <span
                className="text-xs font-mono"
                style={{ color: "var(--text-secondary)" }}
              >
                {terminalTabsUnlimited
                  ? "Unlimited"
                  : `~${terminalTabLimit * 9} MB total`}
              </span>
            </SettingRow>

            <SettingRow
              label="Show terminal bell"
              description="Visual flash when a background process writes to the terminal"
            >
              <Toggle
                checked={true}
                onChange={() => {}}
                label="Terminal bell"
              />
            </SettingRow>
          </Section>

          <Divider />

          {/* ── Windows ── */}
          <Section icon={Square} title="Windows" id="windows">
            <SettingRow
              label="Open files in new window"
              description="Double-clicking a file or opening from Finder spawns a new app window"
            >
              <Toggle
                checked={sandboxNewWindows}
                onChange={v => setSandboxNewWindows(v)}
                label="Sandbox in new windows"
                description="New windows share the same vault/sandbox context"
              />
            </SettingRow>

            <SettingRow
              label="New window position"
              description="Where new app windows appear on screen"
            >
              <select
                className="text-xs px-2 py-1 rounded border"
                style={{
                  background: "var(--surface-2)",
                  borderColor: "var(--surface-3)",
                  color: "var(--text-secondary)",
                }}
                defaultValue="cascade"
              >
                <option value="cascade">Cascade from top-left</option>
                <option value="center">Centered</option>
                <option value="offset">Offset from last window</option>
              </select>
            </SettingRow>
          </Section>

          <Divider />

          {/* ── Keyboard ── */}
          <Section icon={Keyboard} title="Keyboard Shortcuts" id="keyboard">
            <div
              className="rounded-lg border overflow-hidden"
              style={{ borderColor: "var(--surface-3)" }}
            >
              {SHORTCUT_LABELS.map((shortcut, i) => {
                const chord =
                  keymap[shortcut.action] ?? DEFAULT_KEYMAP[shortcut.action];
                const isCustom = chord !== DEFAULT_KEYMAP[shortcut.action];
                const isRecording = recordingAction === shortcut.action;
                return (
                  <div
                    key={shortcut.action}
                    className="flex items-center justify-between px-3 py-2"
                    style={{
                      background:
                        i % 2 === 0 ? "var(--surface-0)" : "transparent",
                      borderBottom:
                        i < SHORTCUT_LABELS.length - 1
                          ? "1px solid var(--surface-3)"
                          : "none",
                    }}
                  >
                    <span
                      className="text-xs"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {shortcut.label}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {isRecording ? (
                        <span
                          className="text-[10px] px-2 py-0.5 rounded animate-pulse"
                          style={{
                            background: "var(--surface-2)",
                            color: "var(--accent-teal)",
                          }}
                        >
                          Press keys… (Esc to cancel)
                        </span>
                      ) : (
                        <KeyHint chord={chord} />
                      )}
                      <button
                        onClick={() =>
                          setRecordingAction(
                            isRecording ? null : shortcut.action
                          )
                        }
                        className="flex items-center justify-center w-5 h-5 rounded transition-colors hover:opacity-80"
                        style={{
                          color: isRecording
                            ? "var(--accent-teal)"
                            : "var(--text-tertiary)",
                        }}
                        title="Change shortcut"
                      >
                        <SquarePen size={11} />
                      </button>
                      {isCustom && (
                        <button
                          onClick={() =>
                            setKeymapBinding(
                              shortcut.action,
                              DEFAULT_KEYMAP[shortcut.action]
                            )
                          }
                          className="flex items-center justify-center w-5 h-5 rounded transition-colors hover:opacity-80"
                          style={{ color: "var(--text-tertiary)" }}
                          title="Reset to default"
                        >
                          <RotateCcw size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => {
                Object.entries(DEFAULT_KEYMAP).forEach(([action, chord]) =>
                  setKeymapBinding(action, chord)
                );
              }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors hover:opacity-80"
              style={{
                background: "var(--surface-0)",
                borderColor: "var(--surface-3)",
                color: "var(--text-secondary)",
              }}
            >
              <RotateCcw size={11} />
              Reset all to defaults
            </button>
          </Section>

          <Divider />

          {/* ── Agent & Narration ── */}
          <Section icon={Bot} title="Agent &amp; Narration" id="agent">
            <SettingRow
              label="Sidecar engine"
              description="The AI engine used for narration, commentary, and chat"
            >
              <select
                className="text-xs px-2 py-1 rounded border"
                style={{
                  background: "var(--surface-2)",
                  borderColor: "var(--surface-3)",
                  color: "var(--text-secondary)",
                }}
                defaultValue="pi"
              >
                <option value="pi">Pi (default)</option>
                <option value="claude">Claude via API</option>
                <option value="openai">OpenAI</option>
              </select>
            </SettingRow>

            <SettingRow
              label="Thinking level"
              description="How much reasoning effort the sidecar uses"
            >
              <select
                className="text-xs px-2 py-1 rounded border"
                style={{
                  background: "var(--surface-2)",
                  borderColor: "var(--surface-3)",
                  color: "var(--text-secondary)",
                }}
                defaultValue="medium"
              >
                <option value="off">Off</option>
                <option value="minimal">Minimal</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="xhigh">Extra High</option>
                <option value="global">Global (use Pi config)</option>
              </select>
            </SettingRow>

            <SettingRow
              label="Drift detection"
              description="Alert when agent output seems off-task"
            >
              <Toggle
                checked={true}
                onChange={() => {}}
                label="Drift detection"
              />
            </SettingRow>

            <SettingRow
              label="Narration flush interval"
              description="How often the terminal output is summarized"
            >
              <select
                className="text-xs px-2 py-1 rounded border"
                style={{
                  background: "var(--surface-2)",
                  borderColor: "var(--surface-3)",
                  color: "var(--text-secondary)",
                }}
                defaultValue="idle"
              >
                <option value="5s">Every 5 seconds</option>
                <option value="10s">Every 10 seconds</option>
                <option value="idle">On idle (2.5s after last output)</option>
                <option value="manual">Manual only</option>
              </select>
            </SettingRow>
          </Section>

          <Divider />

          {/* ── Heartbeat ── */}
          <Section icon={HeartPulse} title="Heartbeat" id="heartbeat">
            <SettingRow
              label="Heartbeat"
              description="Checks in while you're away and posts a 'while you were away' summary when something happened. Quiet while you're watching."
            >
              <HeartbeatToggleButton
                enabled={heartbeatEnabled}
                onChange={setHeartbeatEnabled}
              />
            </SettingRow>

            <SettingRow
              label="Check interval"
              description="How often the heartbeat checks in while you're away"
            >
              <HeartbeatIntervalSelector
                value={heartbeatIntervalMinutes}
                onChange={setHeartbeatIntervalMinutes}
                disabled={!heartbeatEnabled}
              />
            </SettingRow>

            <SettingRow
              label="Agent process names"
              description="Process names Wenmei watches for to detect when an agent finishes running in a terminal tab. Comma-separated."
            >
              <input
                type="text"
                value={agentNamesDraft}
                onChange={e => setAgentNamesDraft(e.target.value)}
                onBlur={commitAgentNames}
                onKeyDown={e => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                disabled={!heartbeatEnabled}
                placeholder="pi, claude, codex, kimi, opencode"
                className="text-[11px] px-2 py-1 rounded w-56 outline-none disabled:opacity-40"
                style={{
                  background: "var(--surface-2)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--surface-3)",
                }}
              />
            </SettingRow>
          </Section>

          <Divider />

          {/* ── Integrations ── */}
          <Section icon={Link2} title="Integrations" id="integrations">
            <CliIntegrationRow />

            {platform === "macos" && (
              <InstallScriptRow
                label="Finder Service"
                description="Right-click context menu for markdown files"
                scriptName="finder"
              />
            )}

            {platform === "macos" && (
              <InstallScriptRow
                label="Quick Look extension"
                description="Markdown preview in Finder's space bar"
                scriptName="quicklook"
              />
            )}

            <ControlPlaneRow />

            <SettingRow
              label="MCP server"
              description="Model Context Protocol adapter for Claude Code / Codex"
            >
              <div className="flex items-center gap-2">
                <span
                  className="text-xs px-2 py-1 rounded"
                  style={{
                    background: "var(--surface-2)",
                    color: "var(--text-tertiary)",
                  }}
                >
                  Not configured
                </span>
                <button
                  className="text-[10px] px-2 py-1 rounded font-medium"
                  style={{
                    background: "var(--surface-2)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--surface-3)",
                  }}
                >
                  Configure
                </button>
              </div>
            </SettingRow>
          </Section>

          <Divider />

          {/* ── License ── */}
          <Section icon={Key} title="License" id="license">
            <SettingRow
              label="Current tier"
              description="Features available in your current plan"
            >
              <span
                className="text-xs px-2 py-1 rounded font-semibold uppercase tracking-wider"
                style={{
                  background:
                    licenseTier === "pro"
                      ? "rgba(251, 191, 36, 0.15)"
                      : "var(--surface-2)",
                  color:
                    licenseTier === "pro" ? "#fbbf24" : "var(--text-tertiary)",
                }}
              >
                {licenseTier}
              </span>
            </SettingRow>

            {licenseTier === "free" && (
              <div
                className="rounded-lg p-4 text-center space-y-2"
                style={{
                  background: "rgba(0, 134, 115, 0.06)",
                  border: "1px solid rgba(0, 134, 115, 0.2)",
                }}
              >
                <p
                  className="text-xs font-medium"
                  style={{ color: "var(--text-primary)" }}
                >
                  Upgrade to Pro
                </p>
                <p
                  className="text-[10px] leading-relaxed"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  Unlocks narration, diff review, run history, multiple vaults,
                  steering, and scheduled recipes.
                </p>
                <p
                  className="text-[10px] font-medium"
                  style={{ color: "var(--accent-teal)" }}
                >
                  $79 one-time · wenmei.app
                </p>
              </div>
            )}

            {licenseTier === "pro" && licenseKey && (
              <SettingRow
                label="Key on file"
                description="Your one-time purchase key — verified offline"
              >
                <div className="flex items-center gap-2">
                  <code
                    className="text-[10px] font-mono px-2 py-1 rounded max-w-[200px] truncate block"
                    style={{
                      background: "var(--surface-2)",
                      color: "var(--text-secondary)",
                    }}
                    title={licenseKey}
                  >
                    {licenseKey}
                  </code>
                  <button
                    onClick={handleCopyLicenseKey}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors"
                    style={{
                      color: copiedKey
                        ? "var(--accent-teal)"
                        : "var(--text-tertiary)",
                    }}
                  >
                    {copiedKey ? <Check size={10} /> : <Copy size={10} />}
                    {copiedKey ? "Copied" : "Copy"}
                  </button>
                </div>
              </SettingRow>
            )}

            <SettingRow
              label={licenseKey ? "Replace license key" : "License key"}
              description={
                licenseKey
                  ? "Enter a new key to swap, or clear to revert to Free"
                  : "Paste a key to unlock Pro — verified offline, never leaves your machine"
              }
            >
              <div className="flex items-center gap-2">
                <input
                  defaultValue=""
                  placeholder={
                    licenseKey ? "Enter new key to replace" : "WENMEI-XXXX-XXXX"
                  }
                  onBlur={e => {
                    const value = e.target.value.trim();
                    if (value && value !== licenseKey) {
                      setLicenseKey(value);
                      e.target.value = "";
                    }
                  }}
                  className="text-[10px] font-mono px-2 py-1 rounded outline-none w-44"
                  style={{
                    background: "var(--surface-0)",
                    border: "1px solid var(--surface-3)",
                    color: "var(--text-primary)",
                  }}
                />
                {licenseKey && (
                  <button
                    onClick={() => setLicenseKey(null)}
                    className="text-[10px] px-2 py-1 rounded transition-colors"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </SettingRow>
          </Section>

          <Divider />

          {/* ── About ── */}
          <Section icon={Info} title="About" id="about">
            <SettingRow
              label="Version"
              description="Wenmei desktop application"
            >
              <span
                className="text-xs font-mono"
                style={{ color: "var(--text-secondary)" }}
              >
                0.2.1 · aarch64-apple-darwin
              </span>
            </SettingRow>

            <CheckUpdateRow />

            <SettingRow
              label="Build date"
              description="When this binary was compiled"
            >
              <span
                className="text-xs"
                style={{ color: "var(--text-tertiary)" }}
              >
                7 Jul 2026
              </span>
            </SettingRow>

            <SettingRow
              label="Data directory"
              description="Where Wenmei stores state and vaults"
            >
              <code
                className="text-[9px] font-mono px-2 py-1 rounded block max-w-[240px] truncate"
                style={{
                  background: "var(--surface-2)",
                  color: "var(--text-tertiary)",
                }}
                title="~/Library/Application Support/Wenmei"
              >
                ~/Library/Application Support/Wenmei
              </code>
            </SettingRow>

            <div className="flex items-center gap-3 pt-1">
              <a
                href="https://wenmei.dev/docs"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[10px] transition-colors"
                style={{ color: "var(--accent-teal)" }}
              >
                <ExternalLink size={10} />
                Documentation
              </a>
              <a
                href="https://wenmei.dev/changelog"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[10px] transition-colors"
                style={{ color: "var(--accent-teal)" }}
              >
                <ExternalLink size={10} />
                Changelog
              </a>
              <a
                href="https://wenmei.dev/support"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[10px] transition-colors"
                style={{ color: "var(--accent-teal)" }}
              >
                <ExternalLink size={10} />
                Support
              </a>
            </div>
          </Section>
        </div>
      </div>

      {promptEditorOpen && (
        <NarrationPromptEditor onClose={() => setPromptEditorOpen(false)} />
      )}
    </div>
  );
}
