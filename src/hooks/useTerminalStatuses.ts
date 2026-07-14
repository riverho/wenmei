import { useEffect } from "react";
import { useAppStore } from "@/store/appStore";
import { terminalStatuses, type TerminalActivity } from "@/lib/tauri-bridge";

export type StatusMap = Record<string, TerminalActivity>;

/**
 * Polls live per-tab terminal status into the store, regardless of which
 * center-panel mode is active. Previously this poll lived inside
 * TerminalPanel's own effect, so it (and the tab dots it drives) went dark
 * whenever CenterPanel unmounted TerminalPanel (any mode other than
 * "terminal") — the Header terminal button had no way to show a live
 * needs-input/stuck badge from outside Terminal mode. Backs off to a
 * slower cadence while the window is unfocused, matching the backend
 * pollers (polling.rs, heartbeat.rs).
 */
export function useTerminalStatuses() {
  const setTerminalTabStatuses = useAppStore(s => s.setTerminalTabStatuses);

  useEffect(() => {
    let alive = true;
    let id: number;
    async function tick() {
      try {
        const list = await terminalStatuses();
        if (!alive) return;
        const map: StatusMap = {};
        for (const s of list) map[s.session_id] = s.activity;
        setTerminalTabStatuses(map);
      } catch {
        /* backend not ready — leave statuses as they were */
      } finally {
        if (alive) {
          id = window.setTimeout(tick, document.hasFocus() ? 1500 : 6000);
        }
      }
    }
    tick();
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [setTerminalTabStatuses]);
}
