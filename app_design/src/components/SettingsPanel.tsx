import { useState } from "react";
import { useAppStore } from "@/store/appStore";
import {
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
} from "lucide-react";

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

// ─── Section heading ────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
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

// ─── Key hint ────────────────────────────────────────────────────────────────

function KeyHint({ chord }: { chord: string }) {
  const keys = chord.split("+").map(k => {
    const lower = k.toLowerCase();
    if (lower === "meta" || lower === "cmdorctrl") return "⌘";
    if (lower === "ctrl" || lower === "control") return "⌃";
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

// ─── Default keymap ─────────────────────────────────────────────────────────

const DEFAULT_SHORTCUTS = [
  { action: "toggleLeftPanel", label: "Toggle left panel" },
  { action: "focusEditor", label: "Focus editor" },
  { action: "toggleRightPanel", label: "Toggle right panel + focus Pi" },
  { action: "paperMode", label: "Paper mode" },
  { action: "newFile", label: "New file" },
  { action: "newFolder", label: "New folder" },
  { action: "searchFiles", label: "Search files" },
  { action: "toggleTheme", label: "Cycle theme" },
  { action: "splitMode", label: "Split view" },
  { action: "editMode", label: "Edit mode" },
  { action: "previewMode", label: "Preview mode" },
];

function MultiInstanceToggle() {
  const [on, setOn] = useState(true);
  return (
    <Toggle
      checked={on}
      onChange={setOn}
      label="One window per vault"
      description="Vault menu › Open in new window"
    />
  );
}

// ─── Vaults section — multi-select management ─────────────────────────────────

function VaultsSection() {
  const vaults = useAppStore(s => s.vaults);
  const activeVaultId = useAppStore(s => s.activeVaultId);
  const removeVaults = useAppStore(s => s.removeVaults);
  const addLocalVault = useAppStore(s => s.addLocalVault);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const removable = vaults.filter(v => v.id !== activeVaultId);
  const allSelected =
    removable.length > 0 && removable.every(v => selected.has(v.id));

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(removable.map(v => v.id)));
  }

  function handleAdd() {
    const n = vaults.length + 1;
    addLocalVault(`folder-${n}`, `~/Projects/folder-${n}`);
  }

  function handleRemoveSelected() {
    removeVaults([...selected]);
    setSelected(new Set());
  }

  return (
    <Section icon={FolderOpen} title="Vaults">
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
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded font-medium"
            style={{ background: "var(--accent-teal)", color: "#fff" }}
          >
            <Plus size={10} />
            Add folder
          </button>
          <button
            onClick={handleRemoveSelected}
            disabled={selected.size === 0}
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
    </Section>
  );
}

// ─── Main Settings panel ───────────────────────────────────────────────────────

export default function SettingsPanel() {
  const {
    narrateByDefault,
    setNarrateByDefault,
    terminalTabLimit,
    setTerminalTabLimit,
    terminalTabsUnlimited,
    setTerminalTabsUnlimited,
    sandboxNewWindows,
    setSandboxNewWindows,
    licenseTier,
    licenseKey,
    platform,
  } = useAppStore();

  const [copiedKey, setCopiedKey] = useState(false);

  const handleCopyLicenseKey = () => {
    if (licenseKey) {
      navigator.clipboard.writeText(licenseKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  return (
    <div
      className="h-full overflow-y-auto wenmei-scroll"
      style={{ background: "var(--surface-1)" }}
    >
      <div className="max-w-xl mx-auto px-6 py-5 space-y-6">
        {/* ── General ── */}
        <Section icon={Settings} title="General">
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
              checked={true}
              onChange={() => {}}
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
        <Section icon={Terminal} title="Terminal">
          <SettingRow
            label="Narration by default"
            description="New terminal tabs start with narration enabled"
          >
            <Toggle
              checked={narrateByDefault}
              onChange={v => setNarrateByDefault(v)}
              label="Narrate by default"
              description="When enabled, new tabs start with narration on"
            />
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
            label="Estimated memory per tab"
            description="Based on PTY scrollback + xterm buffer allocation"
          >
            <span
              className="text-xs font-mono"
              style={{ color: "var(--text-secondary)" }}
            >
              ~9 MB / tab
            </span>
          </SettingRow>

          <SettingRow
            label="Show terminal bell"
            description="Visual flash when a background process writes to the terminal"
          >
            <Toggle checked={true} onChange={() => {}} label="Terminal bell" />
          </SettingRow>
        </Section>

        <Divider />

        {/* ── Windows ── */}
        <Section icon={Square} title="Windows">
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
            label="Multiple app instances"
            description="Run Wenmei windows for different folders side by side — each vault gets its own window, sandbox scope, and terminal sessions (single-instance lock removed)"
          >
            <MultiInstanceToggle />
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
        <Section icon={Keyboard} title="Keyboard Shortcuts">
          <div
            className="rounded-lg border overflow-hidden"
            style={{ borderColor: "var(--surface-3)" }}
          >
            {DEFAULT_SHORTCUTS.map((shortcut, i) => (
              <div
                key={shortcut.action}
                className="flex items-center justify-between px-3 py-2"
                style={{
                  background: i % 2 === 0 ? "var(--surface-0)" : "transparent",
                  borderBottom:
                    i < DEFAULT_SHORTCUTS.length - 1
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
                <KeyHint chord={`Ctrl+${i + 1}`} />
              </div>
            ))}
          </div>

          <button
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors"
            style={{
              background: "var(--surface-0)",
              borderColor: "var(--surface-3)",
              color: "var(--text-secondary)",
            }}
          >
            <Keyboard size={11} />
            Customize shortcuts
          </button>
        </Section>

        <Divider />

        {/* ── Agent & Narration ── */}
        <Section icon={Bot} title="Agent &amp; Narration">
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
            label="Auto-briefing"
            description="Paste session summary into new terminal tabs on start"
          >
            <Toggle checked={false} onChange={() => {}} label="Auto-briefing" />
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

        {/* ── Integrations ── */}
        <Section icon={Link2} title="Integrations">
          <SettingRow
            label="CLI integration"
            description="The wenmei command in your terminal"
          >
            <div className="flex items-center gap-2">
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
              <button
                className="text-[10px] px-2 py-1 rounded"
                style={{ color: "var(--text-tertiary)" }}
              >
                Reinstall
              </button>
            </div>
          </SettingRow>

          {platform === "macos" && (
            <SettingRow
              label="Finder Service"
              description="Right-click context menu for markdown files"
            >
              <div className="flex items-center gap-2">
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
              </div>
            </SettingRow>
          )}

          {platform === "macos" && (
            <SettingRow
              label="Quick Look extension"
              description="Markdown preview in Finder's space bar"
            >
              <div className="flex items-center gap-2">
                <span
                  className="text-xs px-2 py-1 rounded"
                  style={{
                    background: "var(--surface-2)",
                    color: "var(--text-tertiary)",
                  }}
                >
                  Not installed
                </span>
                <button
                  className="text-[10px] px-2 py-1 rounded font-medium"
                  style={{
                    background: "var(--accent-teal)",
                    color: "#fff",
                  }}
                >
                  Install
                </button>
              </div>
            </SettingRow>
          )}

          <SettingRow
            label="Control plane"
            description="Local JSON-RPC server for external agents"
          >
            <div className="flex items-center gap-2">
              <span
                className="flex items-center gap-1 text-xs px-2 py-1 rounded"
                style={{
                  background: "rgba(0, 134, 115, 0.1)",
                  color: "var(--accent-teal)",
                }}
              >
                <Check size={10} />
                Running on 127.0.0.1
              </span>
              <button
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded"
                style={{ color: "var(--text-tertiary)" }}
              >
                <Copy size={10} />
                Copy token
              </button>
            </div>
          </SettingRow>

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
        <Section icon={Key} title="License">
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
              <button
                className="text-xs px-4 py-1.5 rounded-lg font-medium transition-all hover:-translate-y-0.5"
                style={{ background: "var(--accent-teal)", color: "#fff" }}
              >
                Get Pro — $79 one-time
              </button>
            </div>
          )}

          {licenseTier === "pro" && (
            <SettingRow
              label="License key"
              description="Your one-time purchase key"
            >
              {licenseKey ? (
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
              ) : (
                <span
                  className="text-[10px]"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  No key entered
                </span>
              )}
            </SettingRow>
          )}

          <SettingRow
            label="Restore purchases"
            description="Re-verify your license from our servers"
          >
            <button
              className="text-[10px] px-3 py-1 rounded border transition-colors"
              style={{
                background: "var(--surface-0)",
                borderColor: "var(--surface-3)",
                color: "var(--text-secondary)",
              }}
            >
              Restore
            </button>
          </SettingRow>
        </Section>

        <Divider />

        {/* ── About ── */}
        <Section icon={Info} title="About">
          <SettingRow label="Version" description="Wenmei desktop application">
            <span
              className="text-xs font-mono"
              style={{ color: "var(--text-secondary)" }}
            >
              0.2.1 · aarch64-apple-darwin
            </span>
          </SettingRow>

          <SettingRow
            label="Build date"
            description="When this binary was compiled"
          >
            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
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
  );
}
