import { useEffect, useState } from "react";
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
} from "lucide-react";
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
  md: "max-w-[420px]",
  lg: "max-w-xl",
  xl: "max-w-3xl",
  full: "max-w-[calc(100vw-32px)] h-[calc(100vh-32px)]",
};

const SIZE_HEIGHTS: Record<string, string> = {
  sm: "max-h-[min(360px,90vh)]",
  md: "max-h-[min(560px,92vh)]",
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
      return <SettingsPlaceholder />;
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
  } = useAppStore();
  const [page, setPage] = useState<OnboardPage>(1);
  const [selected, setSelected] = useState({
    cli: true,
    finder: true,
    quicklook: false,
  });

  const isInstalling = Object.values(installResults).some(
    s => s === "installing"
  );
  const allDone =
    installResults.cli === "done" &&
    installResults.finder === "done" &&
    installResults.quicklook === "done";
  const anyError = Object.values(installResults).some(s => s === "error");

  async function handlePage1Install() {
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
      if (selected.quicklook || selected.quicklook) {
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
          Welcome to Wenmei
        </h3>
        <p
          className="text-[11px] leading-relaxed max-w-[260px] mx-auto"
          style={{ color: "var(--text-secondary)" }}
        >
          Your calm, folder-native thinking environment. Markdown files stay as
          plain files — no database, no proprietary format.
        </p>
      </div>

      <div className="h-px" style={{ background: "var(--surface-3)" }} />

      <div className="space-y-1.5">
        <CheckboxRow
          icon={Terminal}
          label="Install CLI"
          desc="wenmei command for terminal integration"
          checked={selected.cli}
          status={installResults.cli}
          onChange={c => setSelected(s => ({ ...s, cli: c }))}
          disabled={isInstalling}
        />
        <CheckboxRow
          icon={FolderSearch}
          label="Finder Service"
          desc="Right-click context menu for markdown files"
          checked={selected.finder}
          status={installResults.finder}
          onChange={c => setSelected(s => ({ ...s, finder: c }))}
          disabled={isInstalling}
        />
        <CheckboxRow
          icon={Eye}
          label="Quick Look & Pi"
          desc="Markdown preview + AI assistant (needs brew + Pi)"
          checked={selected.quicklook}
          status={installResults.quicklook}
          onChange={c => setSelected(s => ({ ...s, quicklook: c }))}
          disabled={isInstalling}
        />
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
          ) : selected.quicklook ? (
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

function SettingsPlaceholder() {
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
    <div className="p-8 space-y-4">
      <div className="text-center space-y-1.5">
        <div className="flex items-center justify-center gap-2">
          <Terminal size={16} style={{ color: "var(--accent-teal)" }} />
          <span
            className="display-font text-base font-medium"
            style={{ color: "var(--text-primary)" }}
          >
            Settings
          </span>
        </div>
        <p
          className="text-xs leading-relaxed"
          style={{ color: "var(--text-secondary)" }}
        >
          System integrations and local app preferences.
        </p>
      </div>

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
