import { useEffect, useState, type ReactNode } from "react";
import { useAppStore } from "@/store/appStore";
import {
  X,
  Sparkles,
  Loader2,
  Check,
  Terminal,
  FolderSearch,
  Eye,
  ExternalLink,
  AlertCircle,
  Link2,
  SlidersHorizontal,
  TerminalSquare,
  AppWindow,
  Radio,
  KeyRound,
  Info,
  Shield,
  Palette,
  Keyboard,
  RotateCcw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  runInstallScript,
  installCliIntegration,
  cliIntegrationStatus,
  completeOnboarding,
  ensureDefaultVault,
  readFile,
  listVaults,
} from "@/lib/tauri-bridge";

const SIZE_CLASSES: Record<string, string> = {
  sm: "max-w-sm",
  md: "max-w-[460px]",
  lg: "max-w-xl",
  xl: "max-w-3xl",
  full: "max-w-[calc(100vw-32px)] h-[calc(100vh-32px)]",
};

const SIZE_HEIGHTS: Record<string, string> = {
  sm: "max-h-[min(360px,90vh)]",
  md: "max-h-[min(600px,92vh)]",
  lg: "max-h-[min(640px,90vh)]",
  xl: "max-h-[min(720px,90vh)]",
  full: "h-full",
};

export default function Lightbox() {
  const {
    lightboxOpen,
    lightboxVariant,
    lightboxTitle,
    lightboxSize,
    closeLightbox,
  } = useAppStore();

  const isOnboarding = lightboxVariant === "onboarding";

  useEffect(() => {
    document.body.style.overflow = lightboxOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [lightboxOpen]);

  if (!lightboxOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={isOnboarding ? undefined : closeLightbox}
    >
      <div
        className="absolute inset-0"
        style={{
          background: "rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      />
      <div
        className={`relative w-full ${SIZE_CLASSES[lightboxSize] ?? "max-w-[420px]"} ${SIZE_HEIGHTS[lightboxSize] ?? "max-h-[min(560px,92vh)]"} flex flex-col overflow-hidden`}
        style={{
          background: "var(--surface-1)",
          borderRadius: isOnboarding ? "12px" : "12px 12px 0 0",
          boxShadow: "0 32px 96px rgba(0,0,0,0.22), 0 0 0 1px var(--surface-3)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {!isOnboarding && (
          <div className="sm:hidden flex items-center justify-center pt-2 pb-1">
            <div
              className="w-10 h-1 rounded-full"
              style={{ background: "var(--surface-3)" }}
            />
          </div>
        )}
        <div
          className="flex items-center justify-between px-5 py-3.5 shrink-0 select-none"
          style={{ borderBottom: "1px solid var(--surface-3)" }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <LightboxIcon variant={lightboxVariant} />
            <h2
              className="text-sm font-semibold truncate"
              style={{ color: "var(--text-primary)" }}
            >
              {lightboxTitle}
            </h2>
          </div>
          {!isOnboarding && (
            <button
              onClick={closeLightbox}
              className="flex items-center justify-center w-7 h-7 rounded-md transition-all duration-200 hover:-translate-y-0.5 shrink-0 ml-2"
              style={{ color: "var(--text-tertiary)" }}
              title="Close"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto">
            <LightboxContent variant={lightboxVariant} />
          </div>
        </div>
      </div>
    </div>
  );
}

function LightboxIcon({ variant }: { variant: string | null }) {
  const s = { size: 15, color: "var(--accent-teal)" } as const;
  switch (variant) {
    case "onboarding":
      return <Sparkles {...s} />;
    case "settings":
    case "pi-chat":
      return <Terminal {...s} />;
    default:
      return <Sparkles {...s} />;
  }
}

function LightboxContent({ variant }: { variant: string | null }) {
  switch (variant) {
    case "onboarding":
      return <OnboardingContent />;
    case "settings":
      return <SettingsPanel />;
    default:
      return <DefaultPlaceholder />;
  }
}

type OptKey = "cli" | "finder" | "quicklook";
type OptStatus = "idle" | "installing" | "done" | "error";

interface CheckboxRowProps {
  icon: typeof Terminal;
  label: string;
  desc: string;
  checked: boolean;
  status: OptStatus;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

function CheckboxRow({
  icon: Icon,
  label,
  desc,
  checked,
  status,
  onChange,
  disabled,
}: CheckboxRowProps) {
  const done = status === "done";
  const installing = status === "installing";
  const error = status === "error";
  const isActive = done || error || installing;

  return (
    <label
      className={`flex items-start gap-2.5 px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer select-none ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      style={{
        borderColor: done
          ? "var(--accent-teal)"
          : error
            ? "var(--destructive)"
            : checked
              ? "var(--surface-3)"
              : "var(--surface-2)",
        background: done
          ? "rgba(0, 134, 115, 0.06)"
          : checked
            ? "var(--surface-0)"
            : "var(--surface-0)",
      }}
    >
      <input
        type="checkbox"
        checked={checked || isActive}
        onChange={e => onChange(e.target.checked)}
        disabled={disabled || isActive}
        className="sr-only"
      />
      <div
        className="shrink-0 w-4 h-4 rounded flex items-center justify-center mt-0.5"
        style={{
          background: done
            ? "var(--accent-teal)"
            : error
              ? "var(--destructive)"
              : checked
                ? "var(--surface-2)"
                : "var(--surface-1)",
          border: `1.5px solid ${done ? "var(--accent-teal)" : error ? "var(--destructive)" : checked ? "var(--surface-3)" : "var(--surface-2)"}`,
        }}
      >
        {installing ? (
          <Loader2
            size={10}
            className="animate-spin"
            style={{ color: "var(--text-tertiary)" }}
          />
        ) : done ? (
          <Check size={10} color="#fff" strokeWidth={3} />
        ) : error ? (
          <AlertCircle size={10} color="#fff" strokeWidth={3} />
        ) : checked ? (
          <Check size={10} color="var(--text-tertiary)" strokeWidth={3} />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <Icon
            size={11}
            style={{
              color: done
                ? "var(--accent-teal)"
                : error
                  ? "var(--destructive)"
                  : "var(--text-tertiary)",
            }}
          />
          <span
            className="text-[11px] font-medium"
            style={{ color: "var(--text-primary)" }}
          >
            {label}
          </span>
          {done && (
            <span
              className="text-[10px]"
              style={{ color: "var(--accent-teal)" }}
            >
              — done
            </span>
          )}
          {error && (
            <span
              className="text-[10px]"
              style={{ color: "var(--destructive)" }}
            >
              — failed
            </span>
          )}
          {installing && (
            <span
              className="text-[10px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              — running...
            </span>
          )}
        </div>
        <p
          className="text-[10px] mt-0.5 leading-relaxed"
          style={{ color: "var(--text-tertiary)" }}
        >
          {desc}
        </p>
      </div>
    </label>
  );
}

type OnboardPage = 1 | 2;

function OnboardingContent() {
  const {
    closeLightbox,
    installResults,
    setInstallResult,
    setOnboardingCompleted,
    setActiveFile,
    setVaults,
    platform,
  } = useAppStore();
  const [page, setPage] = useState<OnboardPage>(1);
  const [selected, setSelected] = useState({
    cli: true,
    finder: true,
    quicklook: false,
  });
  const isMac = platform === "macos";

  const isInstalling = Object.values(installResults).some(
    s => s === "installing"
  );
  const allDone =
    installResults.cli === "done" &&
    installResults.finder === "done" &&
    installResults.quicklook === "done";
  const anyError = Object.values(installResults).some(s => s === "error");

  async function handlePage1Install() {
    // Non-macOS: use the native CLI integration command
    if (!isMac) {
      if (selected.cli) {
        setInstallResult("cli", "installing");
        try {
          await installCliIntegration();
          setInstallResult("cli", "done");
        } catch (err) {
          console.error("CLI install failed:", err);
          setInstallResult("cli", "error");
        }
      }
      await finishOnboarding();
      return;
    }

    // macOS: run shell scripts
    const scripts: { key: OptKey; script: string; name: string }[] = [
      { key: "cli", script: "install-cli.sh", name: "CLI" },
      {
        key: "finder",
        script: "install-finder-service.sh",
        name: "Finder Service",
      },
    ];

    for (const { key, script, name } of scripts) {
      if (!selected[key]) {
        setInstallResult(key, "done");
        continue;
      }
      setInstallResult(key, "installing");
      try {
        await runInstallScript(script);
        setInstallResult(key, "done");
      } catch (err) {
        console.error(`${name} install failed:`, err);
        setInstallResult(key, "error");
      }
    }

    const finalResults = useAppStore.getState().installResults;
    const page1Failed =
      (selected.cli && finalResults.cli === "error") ||
      (selected.finder && finalResults.finder === "error");

    if (!page1Failed) {
      if (selected.quicklook) {
        setPage(2);
      } else {
        await finishOnboarding();
      }
    }
  }

  async function finishOnboarding() {
    const result = await ensureDefaultVault();
    const updated = await listVaults();
    setVaults(updated);
    const file = await readFile(result.welcome_path);
    setActiveFile(file.path, file.content, file.name);
    await completeOnboarding();
    setOnboardingCompleted(true);
    closeLightbox();
  }

  async function handleSkip() {
    await completeOnboarding();
    setOnboardingCompleted(true);
    closeLightbox();
  }

  if (page === 2) {
    return <OnboardingPage2 onDone={finishOnboarding} />;
  }

  return (
    <div className="p-8 space-y-4">
      <p
        className="text-[11px] leading-relaxed text-center"
        style={{ color: "var(--text-secondary)" }}
      >
        Your calm, folder-native thinking environment. Markdown files stay as
        plain files — no database, no proprietary format.
      </p>

      <div className="space-y-2">
        <CheckboxRow
          icon={Terminal}
          label="Install CLI"
          desc={
            isMac
              ? "wenmei command for terminal integration"
              : platform === "windows"
                ? "wenmei.cmd in app directory (add to PATH)"
                : "wenmei command for terminal integration"
          }
          checked={selected.cli}
          status={installResults.cli}
          onChange={c => setSelected(s => ({ ...s, cli: c }))}
          disabled={isInstalling}
        />
        {isMac && (
          <CheckboxRow
            icon={FolderSearch}
            label="Finder Service"
            desc="Right-click context menu for markdown files"
            checked={selected.finder}
            status={installResults.finder}
            onChange={c => setSelected(s => ({ ...s, finder: c }))}
            disabled={isInstalling}
          />
        )}
        {isMac && (
          <CheckboxRow
            icon={Eye}
            label="Quick Look & Pi"
            desc="Markdown preview + AI assistant (needs brew + Pi)"
            checked={selected.quicklook}
            status={installResults.quicklook}
            onChange={c => setSelected(s => ({ ...s, quicklook: c }))}
            disabled={isInstalling}
          />
        )}
      </div>

      {anyError && (
        <p
          className="text-[10px] text-center"
          style={{ color: "var(--destructive)" }}
        >
          Some installs failed. You can retry or skip.
        </p>
      )}

      <div className="flex items-center justify-center gap-3 pt-1">
        <button
          onClick={handleSkip}
          disabled={isInstalling}
          className="px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200 border disabled:opacity-50"
          style={{
            color: "var(--text-secondary)",
            background: "var(--surface-0)",
            borderColor: "var(--surface-3)",
          }}
        >
          Skip
        </button>
        <button
          onClick={handlePage1Install}
          disabled={isInstalling}
          className="px-5 py-2 rounded-lg text-xs font-medium transition-all duration-200 flex items-center gap-1.5 disabled:opacity-50"
          style={{ color: "#fff", background: "var(--accent-teal)" }}
        >
          {isInstalling ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              Installing...
            </>
          ) : allDone ? (
            <>
              <Check size={12} />
              Launch
            </>
          ) : isMac && selected.quicklook ? (
            "Next"
          ) : (
            "Install & Launch"
          )}
        </button>
      </div>
    </div>
  );
}

function OnboardingPage2({ onDone }: { onDone: () => void }) {
  return (
    <div className="p-8 space-y-4">
      <div className="text-center space-y-1.5">
        <div className="flex items-center justify-center gap-2">
          <img
            src="/logo-icon.png"
            alt="Wenmei"
            className="w-5 h-5 opacity-80"
          />
          <span
            className="display-font text-base font-medium"
            style={{ color: "var(--text-primary)" }}
          >
            Wenmei
          </span>
        </div>
        <h3
          className="text-sm font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          Quick Look &amp; Pi
        </h3>
        <p
          className="text-[11px] leading-relaxed max-w-[280px] mx-auto"
          style={{ color: "var(--text-secondary)" }}
        >
          Open a terminal and run these commands to install markdown preview and
          an AI assistant.
        </p>
      </div>

      <div className="h-px" style={{ background: "var(--surface-3)" }} />

      <div className="space-y-3">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Eye size={11} style={{ color: "var(--text-tertiary)" }} />
            <span
              className="text-[11px] font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              QLMarkdown — Markdown preview for Quick Look
            </span>
          </div>
          <div className="flex items-center gap-2">
            <code
              className="text-[10px] px-2 py-1 rounded flex-1 select-all"
              style={{
                background: "var(--surface-0)",
                border: "1px solid var(--surface-3)",
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono)",
              }}
            >
              brew install --cask qlmarkdown
            </code>
            <a
              href="https://github.com/sbarex/QLMarkdown"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-0.5 text-[10px] shrink-0"
              style={{ color: "var(--text-tertiary)" }}
            >
              <ExternalLink size={9} />
              source
            </a>
          </div>
          <p
            className="text-[10px] leading-relaxed"
            style={{ color: "var(--accent-teal)" }}
          >
            After installing, open the QLMarkdown app once to register the Quick
            Look extension.
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Terminal size={11} style={{ color: "var(--text-tertiary)" }} />
            <span
              className="text-[11px] font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              Pi — AI assistant
            </span>
          </div>
          <div className="flex items-center gap-2">
            <code
              className="text-[10px] px-2 py-1 rounded flex-1 select-all"
              style={{
                background: "var(--surface-0)",
                border: "1px solid var(--surface-3)",
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono)",
              }}
            >
              curl -fsSL https://pi.dev/install.sh | sh
            </code>
            <a
              href="https://pi.dev/"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-0.5 text-[10px] shrink-0"
              style={{ color: "var(--text-tertiary)" }}
            >
              <ExternalLink size={9} />
              source
            </a>
          </div>
        </div>
      </div>

      <div
        className="rounded-lg px-3 py-2 text-[10px] leading-relaxed"
        style={{
          background: "rgba(0, 134, 115, 0.06)",
          border: "1px solid rgba(0, 134, 115, 0.2)",
          color: "var(--text-secondary)",
        }}
      >
        These are optional. You can always install them later from{" "}
        <strong>Settings</strong>.
      </div>

      <div className="flex items-center justify-center pt-1">
        <button
          onClick={onDone}
          className="px-6 py-2 rounded-lg text-xs font-medium transition-all duration-200"
          style={{ color: "#fff", background: "var(--accent-teal)" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings — sidebar layout with sections
// ---------------------------------------------------------------------------

type SettingsTab =
  | "general"
  | "terminal"
  | "windows"
  | "keyboard"
  | "agent"
  | "integrations"
  | "license"
  | "about";

const SETTINGS_TABS: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "terminal", label: "Terminal", icon: TerminalSquare },
  { id: "windows", label: "Windows", icon: AppWindow },
  { id: "keyboard", label: "Keyboard", icon: Keyboard },
  { id: "agent", label: "Agent & Narration", icon: Radio },
  { id: "integrations", label: "Integrations", icon: Link2 },
  { id: "license", label: "License", icon: KeyRound },
  { id: "about", label: "About", icon: Info },
];

function SettingsPanel() {
  const [tab, setTab] = useState<SettingsTab>("general");

  return (
    <div className="flex h-full min-h-[440px]">
      {/* Section rail */}
      <div
        className="w-44 shrink-0 p-2 overflow-y-auto"
        style={{ borderRight: "1px solid var(--surface-3)" }}
      >
        {SETTINGS_TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-xs mb-0.5 transition-colors text-left"
              style={{
                background: active ? "var(--surface-2)" : "transparent",
                color: active
                  ? "var(--text-primary)"
                  : "var(--text-secondary)",
                fontWeight: active ? 600 : 400,
              }}
            >
              <Icon
                size={13}
                style={{
                  color: active
                    ? "var(--accent-teal)"
                    : "var(--text-tertiary)",
                }}
              />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Section content */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === "general" && <GeneralSection />}
        {tab === "terminal" && <TerminalSection />}
        {tab === "windows" && <WindowsSection />}
        {tab === "keyboard" && <KeyboardSection />}
        {tab === "agent" && <AgentSection />}
        {tab === "integrations" && <IntegrationsSection />}
        {tab === "license" && <LicenseSection />}
        {tab === "about" && <AboutSection />}
      </div>
    </div>
  );
}

function SettingsSectionHeader({
  title,
  desc,
}: {
  title: string;
  desc: string;
}) {
  return (
    <div className="mb-4">
      <h3
        className="display-font text-base font-medium"
        style={{ color: "var(--text-primary)" }}
      >
        {title}
      </h3>
      <p
        className="text-xs mt-0.5 leading-relaxed"
        style={{ color: "var(--text-secondary)" }}
      >
        {desc}
      </p>
    </div>
  );
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="relative w-9 h-5 rounded-full shrink-0 transition-colors"
      style={{ background: on ? "var(--accent-teal)" : "var(--surface-3)" }}
    >
      <span
        className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
        style={{ left: on ? "18px" : "2px" }}
      />
    </button>
  );
}

function SettingRow({
  icon: Icon,
  label,
  desc,
  children,
}: {
  icon?: LucideIcon;
  label: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 py-3"
      style={{ borderBottom: "1px solid var(--surface-3)" }}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        {Icon && (
          <Icon
            size={15}
            className="mt-0.5 shrink-0"
            style={{ color: "var(--text-tertiary)" }}
          />
        )}
        <div className="min-w-0">
          <p
            className="text-xs font-medium"
            style={{ color: "var(--text-primary)" }}
          >
            {label}
          </p>
          {desc && (
            <p
              className="text-[11px] mt-0.5 leading-relaxed"
              style={{ color: "var(--text-tertiary)" }}
            >
              {desc}
            </p>
          )}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="flex items-center rounded-md p-0.5"
      style={{ background: "var(--surface-2)" }}
    >
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="px-2.5 py-1 rounded text-[11px] font-medium transition-all"
            style={{
              background: active ? "var(--surface-1)" : "transparent",
              color: active
                ? "var(--text-primary)"
                : "var(--text-secondary)",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function GeneralSection() {
  const { theme, setTheme } = useAppStore();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [restoreSession, setRestoreSession] = useState(true);
  return (
    <div>
      <SettingsSectionHeader
        title="General"
        desc="Appearance and startup behavior for this machine."
      />
      <SettingRow
        icon={Palette}
        label="Theme"
        desc="System follows your OS appearance."
      >
        <Segmented
          value={theme}
          onChange={v => setTheme(v)}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </SettingRow>
      <SettingRow
        icon={Eye}
        label="Reduce motion"
        desc="Minimize panel slides and reveal animations."
      >
        <Toggle on={reduceMotion} onChange={setReduceMotion} />
      </SettingRow>
      <SettingRow
        icon={FolderSearch}
        label="Restore last session"
        desc="Reopen the last active file and layout on launch."
      >
        <Toggle on={restoreSession} onChange={setRestoreSession} />
      </SettingRow>
    </div>
  );
}

function TerminalSection() {
  const {
    narrateByDefault,
    setNarrateByDefault,
    terminalTabsUnlimited,
    setTerminalTabsUnlimited,
    terminalTabLimit,
    setTerminalTabLimit,
  } = useAppStore();
  return (
    <div>
      <SettingsSectionHeader
        title="Terminal"
        desc="The terminal opens as a plain shell — no Pi seat unless you narrate."
      />
      <SettingRow
        icon={Radio}
        label="Narrate new tabs by default"
        desc="Each new terminal tab starts with the Pi sidecar narrating in plain language."
      >
        <Toggle on={narrateByDefault} onChange={setNarrateByDefault} />
      </SettingRow>
      <SettingRow
        icon={TerminalSquare}
        label="Unlimited tabs"
        desc="Allow as many terminal tabs as memory permits."
      >
        <Toggle
          on={terminalTabsUnlimited}
          onChange={setTerminalTabsUnlimited}
        />
      </SettingRow>
      {!terminalTabsUnlimited && (
        <SettingRow
          label="Tab limit"
          desc={`Cap open terminal tabs (~${9} MB each). Reached limit disables the + button.`}
        >
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={2}
              max={24}
              value={terminalTabLimit}
              onChange={e => setTerminalTabLimit(Number(e.target.value))}
              className="w-28 accent-[var(--accent-teal)]"
            />
            <span
              className="text-xs font-mono w-6 text-right"
              style={{ color: "var(--text-primary)" }}
            >
              {terminalTabLimit}
            </span>
          </div>
        </SettingRow>
      )}
    </div>
  );
}

function WindowsSection() {
  const { sandboxNewWindows, setSandboxNewWindows } = useAppStore();
  const [reuseWindow, setReuseWindow] = useState(false);
  return (
    <div>
      <SettingsSectionHeader
        title="Windows"
        desc="Open files across multiple Wenmei windows, each with its own scope."
      />
      <SettingRow
        icon={Shield}
        label="New windows open with sandbox on"
        desc="Files opened in a new window get an isolated sandbox scope for agents."
      >
        <Toggle on={sandboxNewWindows} onChange={setSandboxNewWindows} />
      </SettingRow>
      <SettingRow
        icon={AppWindow}
        label="Reuse existing window"
        desc="Open files in the current window instead of spawning a new one."
      >
        <Toggle on={reuseWindow} onChange={setReuseWindow} />
      </SettingRow>
      <p
        className="text-[11px] mt-3 leading-relaxed"
        style={{ color: "var(--text-tertiary)" }}
      >
        Right-click any file → <strong>Open in new window</strong>, or press
        Ctrl+Shift+O on the active file.
      </p>
    </div>
  );
}

function AgentSection() {
  const [depth, setDepth] = useState<"off" | "brief" | "detailed">("brief");
  const [flagRisky, setFlagRisky] = useState(true);
  const [confirmInject, setConfirmInject] = useState(true);
  return (
    <div>
      <SettingsSectionHeader
        title="Agent & Narration"
        desc="How the Pi sidecar observes and reports on terminal agents."
      />
      <SettingRow
        icon={Radio}
        label="Narration depth"
        desc="How much detail the sidecar summarizes per digest."
      >
        <Segmented
          value={depth}
          onChange={setDepth}
          options={[
            { value: "off", label: "Off" },
            { value: "brief", label: "Brief" },
            { value: "detailed", label: "Detailed" },
          ]}
        />
      </SettingRow>
      <SettingRow
        icon={AlertCircle}
        label="Flag risky changes"
        desc="Highlight edits the agent made that you didn't ask for."
      >
        <Toggle on={flagRisky} onChange={setFlagRisky} />
      </SettingRow>
      <SettingRow
        icon={Shield}
        label="Confirm before injecting"
        desc="Require a click before the sidecar types into a terminal."
      >
        <Toggle on={confirmInject} onChange={setConfirmInject} />
      </SettingRow>
    </div>
  );
}

function LicenseSection() {
  const { licenseTier } = useAppStore();
  const isPro = licenseTier === "pro";
  return (
    <div>
      <SettingsSectionHeader
        title="License"
        desc="Wenmei is local-first — your files never leave your machine."
      />
      <div
        className="rounded-xl border p-4 flex items-center justify-between gap-4"
        style={{
          borderColor: isPro ? "var(--accent-teal)" : "var(--surface-3)",
          background: isPro ? "rgba(0,134,115,0.06)" : "var(--surface-0)",
        }}
      >
        <div>
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {isPro ? "Pro" : "Free"}
          </p>
          <p
            className="text-[11px] mt-0.5"
            style={{ color: "var(--text-tertiary)" }}
          >
            {isPro
              ? "Narration, diff review, steering, recipes, multiple vaults."
              : "Editor, one sandbox, manual agent sessions."}
          </p>
        </div>
        {!isPro && (
          <button
            className="px-3 py-1.5 rounded-lg text-xs font-medium shrink-0"
            style={{ background: "var(--accent-teal)", color: "#fff" }}
          >
            Upgrade to Pro
          </button>
        )}
      </div>
      <div className="mt-4">
        <SettingRow
          icon={KeyRound}
          label="License key"
          desc="Paste a key to unlock Pro offline."
        >
          <input
            placeholder="WENMEI-XXetc"
            className="px-2 py-1 rounded-md text-xs font-mono outline-none w-40"
            style={{
              background: "var(--surface-0)",
              border: "1px solid var(--surface-3)",
              color: "var(--text-primary)",
            }}
          />
        </SettingRow>
      </div>
    </div>
  );
}

function AboutSection() {
  return (
    <div>
      <SettingsSectionHeader
        title="About"
        desc="The safe desktop where AI agents do real work on your files."
      />
      <SettingRow label="Version">
        <span className="text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
          0.2.1
        </span>
      </SettingRow>
      <SettingRow label="Backends" desc="Bring your own agent + API key.">
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Tauri · React · Pi
        </span>
      </SettingRow>
      <div className="flex items-center gap-3 mt-4">
        <a
          href="#"
          className="inline-flex items-center gap-1.5 text-xs"
          style={{ color: "var(--accent-teal)" }}
        >
          <ExternalLink size={12} /> Documentation
        </a>
        <a
          href="#"
          className="inline-flex items-center gap-1.5 text-xs"
          style={{ color: "var(--accent-teal)" }}
        >
          <ExternalLink size={12} /> GitHub
        </a>
      </div>
    </div>
  );
}

interface ShortcutDef {
  id: string;
  label: string;
  chord: string;
}

const SHORTCUT_GROUPS: { group: string; items: ShortcutDef[] }[] = [
  {
    group: "Navigation",
    items: [
      { id: "toggle-left", label: "Toggle file sidebar", chord: "Ctrl+1" },
      { id: "focus-editor", label: "Focus editor", chord: "Ctrl+2" },
      { id: "toggle-sidecar", label: "Toggle sidecar (Pi/Review)", chord: "Ctrl+3" },
      { id: "file-search", label: "Search files", chord: "Ctrl+B" },
      { id: "command-palette", label: "Command palette", chord: "Ctrl+K" },
      { id: "workspace-search", label: "Search workspace", chord: "Ctrl+Shift+F" },
    ],
  },
  {
    group: "View & editing",
    items: [
      { id: "edit", label: "Edit mode", chord: "Ctrl+E" },
      { id: "preview", label: "Preview mode", chord: "Ctrl+Shift+P" },
      { id: "split", label: "Split mode", chord: "Ctrl+\\" },
      { id: "paper", label: "Paper mode", chord: "Ctrl+P" },
      { id: "new-file", label: "New file", chord: "Ctrl+N" },
      { id: "new-folder", label: "New folder", chord: "Ctrl+Shift+N" },
      { id: "theme", label: "Cycle theme", chord: "Ctrl+," },
    ],
  },
  {
    group: "Terminal & windows",
    items: [
      { id: "toggle-terminal", label: "Toggle plain terminal", chord: "Ctrl+Shift+`" },
      { id: "new-tab", label: "New terminal tab", chord: "Ctrl+Shift+T" },
      { id: "new-window", label: "Open file in new window", chord: "Ctrl+Shift+O" },
      { id: "settings", label: "Open Settings", chord: "Ctrl+Shift+," },
    ],
  },
];

function chordFromEvent(e: KeyboardEvent): string | null {
  const key = e.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  let label = key.length === 1 ? key.toUpperCase() : key;
  if (e.code === "Backquote") label = "`";
  if (e.code === "Comma") label = ",";
  if (e.code === "Backslash") label = "\\";
  parts.push(label);
  return parts.join("+");
}

function KeyChord({ chord }: { chord: string }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {chord.split("+").map((k, i) => (
        <kbd
          key={i}
          className="px-1.5 py-0.5 rounded text-[10px] font-mono"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--surface-3)",
            color: "var(--text-secondary)",
            minWidth: 18,
            textAlign: "center",
          }}
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

function KeyboardSection() {
  const [bindings, setBindings] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      SHORTCUT_GROUPS.flatMap(g => g.items.map(it => [it.id, it.chord]))
    )
  );
  const [recording, setRecording] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(null);
        return;
      }
      const chord = chordFromEvent(e);
      if (chord) {
        setBindings(prev => ({ ...prev, [recording]: chord }));
        setRecording(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording]);

  function resetAll() {
    setBindings(
      Object.fromEntries(
        SHORTCUT_GROUPS.flatMap(g => g.items.map(it => [it.id, it.chord]))
      )
    );
    setRecording(null);
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4">
        <SettingsSectionHeader
          title="Keyboard"
          desc="Click a shortcut to rebind it. Press the new combination, or Esc to cancel."
        />
        <button
          onClick={resetAll}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] shrink-0 mt-1 hover:opacity-80"
          style={{
            background: "var(--surface-2)",
            color: "var(--text-secondary)",
          }}
        >
          <RotateCcw size={11} />
          Reset
        </button>
      </div>

      {SHORTCUT_GROUPS.map(({ group, items }) => (
        <div key={group} className="mb-5">
          <p
            className="text-[10px] uppercase tracking-wider mb-1.5"
            style={{ color: "var(--text-tertiary)" }}
          >
            {group}
          </p>
          {items.map(item => {
            const isRecording = recording === item.id;
            return (
              <div
                key={item.id}
                className="flex items-center justify-between gap-4 py-2"
                style={{ borderBottom: "1px solid var(--surface-3)" }}
              >
                <span
                  className="text-xs"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {item.label}
                </span>
                <button
                  onClick={() => setRecording(isRecording ? null : item.id)}
                  className="px-2 py-1 rounded-md transition-colors"
                  style={{
                    background: isRecording
                      ? "rgba(0,134,115,0.1)"
                      : "transparent",
                    border: isRecording
                      ? "1px dashed var(--accent-teal)"
                      : "1px solid transparent",
                  }}
                  title="Click to rebind"
                >
                  {isRecording ? (
                    <span
                      className="text-[11px]"
                      style={{ color: "var(--accent-teal)" }}
                    >
                      Press keys…
                    </span>
                  ) : (
                    <KeyChord chord={bindings[item.id]} />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function IntegrationsSection() {
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null);
  const [cliPath, setCliPath] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    cliIntegrationStatus()
      .then(status => {
        if (cancelled) return;
        setCliInstalled(status.installed);
        setCliPath(status.path);
      })
      .catch(err => {
        if (cancelled) return;
        setCliInstalled(false);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleInstallCli() {
    if (installing) return;
    setInstalling(true);
    setError(null);
    setMessage(null);
    try {
      const result = await installCliIntegration();
      const status = await cliIntegrationStatus();
      setCliInstalled(status.installed);
      setCliPath(status.path);
      setMessage(result || "CLI integration installed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="space-y-4">
      <SettingsSectionHeader
        title="System integrations"
        desc="Install shell and Finder helpers so Wenmei opens your markdown from anywhere."
      />

      <div
        className="rounded-xl border p-3 space-y-3"
        style={{
          background: "var(--surface-0)",
          borderColor: "var(--surface-3)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{
                background: "var(--surface-1)",
                color: "var(--accent-teal)",
              }}
            >
              <Link2 size={15} />
            </div>
            <div className="min-w-0">
              <p
                className="text-xs font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                CLI integration
              </p>
              <p
                className="text-[10px] mt-0.5 leading-relaxed"
                style={{ color: "var(--text-tertiary)" }}
              >
                Installs the `wenmei` command and Finder service.
              </p>
              {cliPath && (
                <p
                  className="text-[10px] mt-1 truncate"
                  style={{ color: "var(--text-secondary)" }}
                  title={cliPath}
                >
                  {cliPath}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={handleInstallCli}
            disabled={installing || cliInstalled === true}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 disabled:opacity-60"
            style={{
              background:
                cliInstalled === true
                  ? "var(--surface-2)"
                  : "var(--accent-teal)",
              color: cliInstalled === true ? "var(--text-secondary)" : "#fff",
            }}
          >
            {installing ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                Installing
              </span>
            ) : cliInstalled === true ? (
              "Installed"
            ) : cliInstalled === null ? (
              "Checking"
            ) : (
              "Install"
            )}
          </button>
        </div>

        {message && (
          <p className="text-[10px]" style={{ color: "var(--accent-teal)" }}>
            {message}
          </p>
        )}
        {error && (
          <p className="text-[10px]" style={{ color: "var(--accent-rose)" }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function DefaultPlaceholder() {
  return (
    <div className="p-6 text-center" style={{ color: "var(--text-tertiary)" }}>
      <Sparkles size={24} className="mx-auto mb-2 opacity-30" />
      <p className="text-xs">Lightbox content</p>
    </div>
  );
}
