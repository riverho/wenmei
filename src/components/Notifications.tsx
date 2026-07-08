import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { listen, type UnlistenFn } from "@/lib/tauri-events";

interface NotificationItem {
  kind: string;
  title: string;
  body: string;
  ts: string;
}

export default function Notifications() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    listen<NotificationItem>("wenmei-notification", event => {
      setItems(prev => [event.payload, ...prev].slice(0, 8));
    }).then(fn => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  return (
    <div className="fixed top-2 right-2 z-50">
      <button
        onClick={() => setOpen(!open)}
        className="relative flex h-8 w-8 items-center justify-center rounded border"
        style={{
          background: "var(--surface-0)",
          borderColor: "var(--surface-3)",
          color: "var(--text-secondary)",
        }}
        title="Notifications"
      >
        <Bell size={14} />
        {items.length > 0 && (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full px-1 text-[10px] text-white bg-red-500">
            {items.length}
          </span>
        )}
      </button>
      {open && (
        <div
          className="mt-2 w-72 rounded border p-2 text-xs shadow-lg"
          style={{
            background: "var(--surface-0)",
            borderColor: "var(--surface-3)",
            color: "var(--text-secondary)",
          }}
        >
          {items.length === 0 ? (
            <div style={{ color: "var(--text-tertiary)" }}>No alerts</div>
          ) : (
            items.map(item => (
              <div
                key={`${item.ts}-${item.kind}`}
                className="border-b py-2 last:border-0"
              >
                <div className="font-semibold">{item.title}</div>
                <div style={{ color: "var(--text-tertiary)" }}>{item.body}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
