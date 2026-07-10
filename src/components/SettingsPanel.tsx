import { useEffect, useState } from "react";
import { useAppStore } from "@/store/appStore";
import {
  checkForUpdate,
  cliIntegrationStatus,
  installCliIntegration,
  runInstallScript,
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
          color:
            state === "available" ? "#fff" : "var(--text-secondary)",
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
    setLicenseKey,
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
              <p
                className="text-[10px] font-medium"
                style={{ color: "var(--accent-teal)" }}
              >
                $79 one-time · wenmei.app
              </p>
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
            label="License key"
            description="Paste a key to unlock Pro — verified offline, never leaves your machine"
          >
            <input
              defaultValue={licenseKey ?? ""}
              placeholder="WENMEI-XXXX-XXXX"
              onBlur={e => setLicenseKey(e.target.value.trim() || null)}
              className="text-[10px] font-mono px-2 py-1 rounded outline-none w-44"
              style={{
                background: "var(--surface-0)",
                border: "1px solid var(--surface-3)",
                color: "var(--text-primary)",
              }}
            />
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

          <CheckUpdateRow />

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
