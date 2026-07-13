import type { ChangesetEntry } from "@/lib/tauri-bridge";

export function mergeChangesetEntries(
  current: ChangesetEntry[],
  incoming: ChangesetEntry[]
): ChangesetEntry[] {
  const byPath = new Map(current.map(entry => [entry.path, entry]));
  for (const entry of incoming) {
    byPath.set(entry.path, entry);
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}
