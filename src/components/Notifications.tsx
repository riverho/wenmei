import { Bell } from "lucide-react";
import { useAppStore } from "@/store/appStore";

export default function Notifications() {
  const sidecarItems = useAppStore(s => s.sidecarItems);
  const requestSidecarFilter = useAppStore(s => s.requestSidecarFilter);
  const unreadAlerts = sidecarItems.filter(
    item => item.kind === "alert" && !item.read
  ).length;
  const totalAlerts = sidecarItems.filter(item => item.kind === "alert").length;

  return (
    <button
      onClick={() => requestSidecarFilter("alerts")}
      className="notifications-btn flex items-center justify-center w-8 h-8 rounded transition-all duration-200 hover:-translate-y-0.5 relative"
      style={{ color: "var(--text-secondary)" }}
      title={
        totalAlerts === 0
          ? "Open sidecar alerts"
          : `Open sidecar alerts (${totalAlerts})`
      }
      aria-label={`Open sidecar alerts${
        unreadAlerts ? `, ${unreadAlerts} unread` : ""
      }`}
    >
      <Bell size={15} />
      {unreadAlerts > 0 && (
        <span
          className="absolute top-1 right-1 min-w-[14px] h-[14px] px-1 rounded-full flex items-center justify-center text-[9px] font-semibold"
          style={{ background: "var(--accent-rose)", color: "#fff" }}
        >
          {unreadAlerts > 9 ? "9+" : unreadAlerts}
        </span>
      )}
    </button>
  );
}
