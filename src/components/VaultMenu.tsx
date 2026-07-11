import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Check,
  Plus,
  Minus,
  AppWindow,
  FolderCog,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { openFileWindow, removeVault } from "@/lib/tauri-bridge";

/**
 * Vault pulldown — switch, add (+), soft-remove (−), and open a vault in a
 * separate Wenmei window (real open_file_window command). Removal detaches
 * the folder from state.json via the backend; files on disk are untouched.
 */
export default function VaultMenu({
  onSwitch,
  onAddFolder,
}: {
  onSwitch: (id: string) => void;
  onAddFolder: () => void;
}) {
  const vaults = useAppStore(s => s.vaults);
  const activeVaultId = useAppStore(s => s.activeVaultId);
  const setVaults = useAppStore(s => s.setVaults);
  const openLightbox = useAppStore(s => s.openLightbox);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const activeVault = vaults.find(v => v.id === activeVaultId);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleRemove(id: string) {
    setBusy(id);
    try {
      const remaining = await removeVault(id);
      setVaults(remaining);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded max-w-[160px] hover:bg-black/5"
        style={{ color: "var(--text-tertiary)" }}
        title={activeVault?.path}
      >
        <span className="truncate">{activeVault?.name ?? "Vault"}</span>
        <ChevronDown size={11} className="shrink-0" />
      </button>

      {open && (
        <div
          className="absolute left-0 top-7 z-[150] w-72 rounded-xl overflow-hidden"
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--surface-3)",
            boxShadow: "0 16px 40px rgba(0,0,0,0.2)",
          }}
        >
          <div className="max-h-72 overflow-y-auto py-1">
            {vaults.map(vault => {
              const isActive = vault.id === activeVaultId;
              return (
                <div
                  key={vault.id}
                  className="group flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-black/5"
                  onClick={() => {
                    onSwitch(vault.id);
                    setOpen(false);
                  }}
                >
                  <span className="w-3.5 shrink-0">
                    {isActive && (
                      <Check
                        size={12}
                        style={{ color: "var(--accent-teal)" }}
                      />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className="text-xs truncate"
                      style={{
                        color: isActive
                          ? "var(--text-primary)"
                          : "var(--text-secondary)",
                        fontWeight: isActive ? 600 : 400,
                      }}
                    >
                      {vault.name}
                    </div>
                    <div
                      className="text-[9px] truncate"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      {vault.path}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        openFileWindow(vault.path).catch(err =>
                          window.alert(
                            err instanceof Error ? err.message : String(err)
                          )
                        );
                        setOpen(false);
                      }}
                      className="flex items-center justify-center w-5 h-5 rounded hover:bg-black/10"
                      style={{ color: "var(--text-tertiary)" }}
                      title="Open in new window (separate instance, own sandbox scope)"
                    >
                      <AppWindow size={11} />
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleRemove(vault.id);
                      }}
                      disabled={isActive || busy === vault.id}
                      className="flex items-center justify-center w-5 h-5 rounded hover:bg-black/10 disabled:opacity-30 disabled:cursor-not-allowed"
                      style={{ color: "var(--accent-rose)" }}
                      title={
                        isActive
                          ? "Switch vaults before removing the active one"
                          : "Remove from vault list (soft — files stay on disk)"
                      }
                    >
                      <Minus size={11} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div
            className="flex items-center justify-between px-2 py-1.5"
            style={{ borderTop: "1px solid var(--surface-3)" }}
          >
            <button
              onClick={() => {
                onAddFolder();
                setOpen(false);
              }}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] hover:bg-black/5"
              style={{ color: "var(--accent-teal)" }}
            >
              <Plus size={11} />
              Add folder
            </button>
            <button
              onClick={() => {
                openLightbox("settings", "Settings", "xl");
                setOpen(false);
              }}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] hover:bg-black/5"
              style={{ color: "var(--text-tertiary)" }}
              title="Multi-select add/remove in Settings › Vaults"
            >
              <FolderCog size={11} />
              Manage vaults
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
