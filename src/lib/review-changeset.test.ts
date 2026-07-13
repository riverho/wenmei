import { describe, expect, it } from "vitest";
import { mergeChangesetEntries } from "@/lib/review-changeset";

describe("mergeChangesetEntries", () => {
  it("retains pending files outside the latest poll batch", () => {
    const merged = mergeChangesetEntries(
      [
        {
          path: "a.md",
          status: "modified",
          size: 10,
          baseline_kind: "original",
          versions: [],
        },
        {
          path: "b.md",
          status: "added",
          size: 20,
          baseline_kind: "original",
          versions: [],
        },
      ],
      [
        {
          path: "c.md",
          status: "deleted",
          size: 0,
          baseline_kind: "original",
          versions: [],
        },
      ]
    );

    expect(merged.map(entry => entry.path)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("replaces an existing entry with the latest status and size", () => {
    const merged = mergeChangesetEntries(
      [
        {
          path: "a.md",
          status: "modified",
          size: 10,
          baseline_kind: "original",
          versions: [],
        },
      ],
      [
        {
          path: "a.md",
          status: "baselineMissing",
          size: 30,
          baseline_kind: "accepted",
          versions: [{ version: 1, created_at: "2026-07-13", size: 30 }],
        },
      ]
    );

    expect(merged).toEqual([
      {
        path: "a.md",
        status: "baselineMissing",
        size: 30,
        baseline_kind: "accepted",
        versions: [{ version: 1, created_at: "2026-07-13", size: 30 }],
      },
    ]);
  });
});
