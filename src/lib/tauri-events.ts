// ─── Tauri Events Wrapper ───
// Falls back to browser CustomEvent in mock mode (npm run dev).

import {
  listen as tauriListen,
  type UnlistenFn,
  type Event as TauriEvent,
} from "@tauri-apps/api/event";

export type { UnlistenFn };

const isTauri =
  typeof window !== "undefined" &&
  !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;

export function listen<T>(
  event: string,
  handler: (event: TauriEvent<T>) => void
): Promise<UnlistenFn> {
  if (isTauri) {
    return tauriListen(event, handler);
  }

  // Mock mode: bridge CustomEvent.detail -> TauriEvent.payload
  const wrapped = (e: Event) => {
    const custom = e as CustomEvent<T>;
    handler({
      event: event as never,
      id: 0,
      payload: custom.detail,
    } as TauriEvent<T>);
  };

  window.addEventListener(event, wrapped);
  return Promise.resolve(() => {
    window.removeEventListener(event, wrapped);
  });
}
