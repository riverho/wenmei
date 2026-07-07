import { useEffect, useRef, useState } from "react";
import {
  Bell,
  X,
  FileDiff,
  Radio,
  Bot,
  Info,
  type LucideIcon,
} from "lucide-react";
import { useAppStore, type NotificationKind } from "@/store/appStore";

const KIND_META: Record<
  NotificationKind,
  { icon: LucideIcon; color: string; label: string }
> = {
  review: { icon: FileDiff, color: "var(--accent-teal)", label: "Review" },
  narration: { icon: Radio, color: "#e0a03a", label: "Narration" },
  agent: { icon: Bot, color: "var(--text-secondary)", label: "Agent" },
  system: { icon: Info, color: "var(--text-tertiary)", label: "System" },
};

export default function Notifications() {
  const notifications = useAppStore(s => s.notifications);
  const markNotificationsRead = useAppStore(s => s.markNotificationsRead);
  const dismissNotification = useAppStore(s => s.dismissNotification);
  const clearNotifications = useAppStore(s => s.clearNotifications);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const unread = notifications.filter(n => !n.read).length;

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

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      // Mark read shortly after opening so the badge clears but items stay
      // visually "new" for a beat.
      setTimeout(() => markNotificationsRead(), 1200);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={toggle}
        className="notifications-btn flex items-center justify-center w-8 h-8 rounded transition-all duration-200 hover:-translate-y-0.5 relative"
        style={{
          color: open ? "var(--accent-teal)" : "var(--text-secondary)",
          background: open ? "var(--surface-2)" : "transparent",
        }}
        title="Notifications"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
      >
        <Bell size={15} />
        {unread > 0 && (
          <span
            className="absolute top-1 right-1 min-w-[14px] h-[14px] px-1 rounded-full flex items-center justify-center text-[9px] font-semibold"
            style={{ background: "var(--accent-rose)", color: "#fff" }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-10 z-[120] w-80 rounded-xl overflow-hidden animate-scale-in"
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--surface-3)",
            boxShadow: "0 20px 48px rgba(0,0,0,0.25)",
          }}
        >
          <div
            className="flex items-center justify-between px-3.5 py-2.5"
            style={{ borderBottom: "1px solid var(--surface-3)" }}
          >
            <span
              className="text-xs font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              Notifications
            </span>
            {notifications.length > 0 && (
              <button
                onClick={clearNotifications}
                className="text-[10px] uppercase tracking-wider hover:opacity-70"
                style={{ color: "var(--text-tertiary)" }}
              >
                Clear all
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div
                className="px-4 py-10 text-center"
                style={{ color: "var(--text-tertiary)" }}
              >
                <Bell size={22} className="mx-auto mb-2 opacity-30" />
                <p className="text-xs">You're all caught up</p>
              </div>
            ) : (
              notifications.map(n => {
                const meta = KIND_META[n.kind];
                const Icon = meta.icon;
                return (
                  <div
                    key={n.id}
                    className="group flex items-start gap-2.5 px-3.5 py-2.5 transition-colors relative"
                    style={{
                      borderBottom: "1px solid var(--surface-3)",
                      background: n.read ? "transparent" : "var(--surface-2)",
                    }}
                  >
                    <div
                      className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                      style={{ background: "var(--surface-0)" }}
                    >
                      <Icon size={12} style={{ color: meta.color }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p
                          className="text-xs font-medium truncate"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {n.title}
                        </p>
                        {!n.read && (
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ background: "var(--accent-teal)" }}
                          />
                        )}
                      </div>
                      <p
                        className="text-[11px] leading-relaxed mt-0.5"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {n.body}
                      </p>
                      <p
                        className="text-[10px] mt-1"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {meta.label} · {n.ts}
                      </p>
                    </div>
                    <button
                      onClick={() => dismissNotification(n.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      style={{ color: "var(--text-tertiary)" }}
                      title="Dismiss"
                    >
                      <X size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
