import { useAppStore } from "@/store/appStore";
import FileTree from "./FileTree";
import PiPanel from "./PiPanel";

export function MobileFileDrawer() {
  const { mobileMenuOpen, setMobileMenuOpen } = useAppStore();

  if (!mobileMenuOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[60] md:hidden"
        style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={() => setMobileMenuOpen(false)}
      />
      <div
        className="fixed top-12 left-0 bottom-0 w-[280px] z-[70] md:hidden animate-left-panel"
        style={{
          background: "var(--surface-2)",
          borderRight: "1px solid var(--surface-3)",
        }}
      >
        <FileTree />
      </div>
    </>
  );
}

export function MobilePiSheet() {
  const { mobilePiOpen, setMobilePiOpen } = useAppStore();

  if (!mobilePiOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[60] md:hidden"
        style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={() => setMobilePiOpen(false)}
      />
      <div
        className="fixed bottom-0 left-0 right-0 h-[60vh] z-[70] md:hidden rounded-t-xl overflow-hidden"
        style={{
          background: "var(--surface-glass)",
          backdropFilter: "blur(16px) saturate(140%)",
          borderTop: "1px solid var(--surface-3)",
        }}
      >
        <div className="flex items-center justify-center py-2">
          <div
            className="w-8 h-1 rounded-full"
            style={{ background: "var(--surface-3)" }}
          />
        </div>
        <div className="h-full pb-8">
          <PiPanel />
        </div>
      </div>
    </>
  );
}

export function MobileMenuButton() {
  const { setMobileMenuOpen, setMobilePiOpen } = useAppStore();

  return (
    <div className="flex md:hidden items-center gap-1">
      <button
        onClick={() => setMobileMenuOpen(true)}
        className="flex items-center justify-center w-8 h-8 rounded"
        style={{ color: "var(--text-secondary)" }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="3" width="14" height="1.5" rx="0.75" fill="currentColor" />
          <rect x="1" y="7.25" width="14" height="1.5" rx="0.75" fill="currentColor" />
          <rect x="1" y="11.5" width="14" height="1.5" rx="0.75" fill="currentColor" />
        </svg>
      </button>
      <button
        onClick={() => setMobilePiOpen(true)}
        className="flex items-center justify-center w-8 h-8 rounded"
        style={{ color: "var(--text-secondary)" }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="6" height="5.5" rx="1" fill="currentColor" />
          <rect x="9" y="2" width="6" height="5.5" rx="1" fill="currentColor" />
          <rect x="1" y="8.5" width="6" height="5.5" rx="1" fill="currentColor" />
          <rect x="9" y="8.5" width="6" height="5.5" rx="1" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
