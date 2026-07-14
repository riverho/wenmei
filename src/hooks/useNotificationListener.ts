import { useEffect } from "react";
import { listen, type UnlistenFn } from "@/lib/tauri-events";
import { useAppStore } from "@/store/appStore";
import { relTime } from "@/lib/sidecar-feed";
import type { ChangesetEntry } from "@/lib/tauri-bridge";

/**
 * Listens for `wenmei-notification` and `changeset-updated` regardless of
 * which center-panel mode is active. Previously these lived inside
 * PiPanel's effect, but PiPanel unmounts whenever `mode === "terminal"`
 * (see App.tsx's RightPanel), which silently dropped every live alert
 * (review changes, narration drift, terminal-closed, briefing-ready,
 * staging-cap, agent-completion, ...) while the user was in Terminal mode —
 * exactly when they're most likely to be watching a background agent run.
 */
export function useNotificationListener() {
  const addSidecarItem = useAppStore(s => s.addSidecarItem);

  useEffect(() => {
    let unlistenNotification: UnlistenFn | null = null;
    let unlistenChangeset: UnlistenFn | null = null;

    listen<{
      kind: string;
      title: string;
      body: string;
      session_id?: string | null;
      ts: string;
    }>("wenmei-notification", evt => {
      const note = evt.payload;
      addSidecarItem({
        id: `alert-${note.ts}-${note.kind}`,
        kind: "alert",
        label: "Alert",
        ts: note.ts,
        tsLabel: relTime(note.ts),
        summary: note.title,
        body: `${note.title}\n${note.body}`,
        sessionId: note.session_id ?? undefined,
        severity:
          note.kind.includes("risky") || note.kind.includes("stuck")
            ? "warning"
            : note.kind.includes("done")
              ? "success"
              : "info",
        alertLabel: note.kind,
        artifacts: [],
        read: false,
        expanded: false,
        inOverlay: false,
      });
    }).then(fn => {
      unlistenNotification = fn;
    });

    listen<ChangesetEntry[]>("changeset-updated", evt => {
      const entries = evt.payload;
      if (!entries || entries.length === 0) return;
      const ts = new Date().toISOString();
      addSidecarItem({
        id: `review-${ts}-${entries.length}`,
        kind: "review_change",
        label: "Review",
        ts,
        tsLabel: relTime(ts),
        summary: `${entries.length} file(s) in the changeset`,
        body: entries
          .map(e => `${e.status.toUpperCase().padEnd(9)} ${e.path}`)
          .join("\n"),
        artifacts: [],
        read: false,
        expanded: false,
        inOverlay: false,
      });
    }).then(fn => {
      unlistenChangeset = fn;
    });

    return () => {
      unlistenNotification?.();
      unlistenChangeset?.();
    };
  }, [addSidecarItem]);
}
