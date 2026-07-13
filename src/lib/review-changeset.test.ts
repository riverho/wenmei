import { describe, expect, it } from "vitest";
import { mergeChangesetEntries } from "@/lib/review-changeset";

describe("mergeChangesetEntries", () => {
  it("retains pending files outside the latest poll batch", () => {
    const merged = mergeChangesetEntries(
      [
        { path: "a.md", status: "modified", size: 10 },
        { path: "b.md", status: "added", size: 20 },
      ],
      [{ path: "c.md", status: "deleted", size: 0 }]
    );

    expect(merged.map(entry => entry.path)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("replaces an existing entry with the latest status and size", () => {
    const merged = mergeChangesetEntries(
      [{ path: "a.md", status: "modified", size: 10 }],
      [{ path: "a.md", status: "baselineMissing", size: 30 }]
    );

    expect(merged).toEqual([
      { path: "a.md", status: "baselineMissing", size: 30 },
    ]);
  });
});
