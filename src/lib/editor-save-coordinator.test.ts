import { beforeEach, describe, expect, it, vi } from "vitest";

const { writeFileMock } = vi.hoisted(() => ({
  writeFileMock: vi.fn(),
}));

vi.mock("@/lib/tauri-bridge", () => ({
  writeFile: writeFileMock,
}));

import {
  onEditorBufferInvalidated,
  runExclusiveEditorFileOperation,
  saveEditorFile,
} from "@/lib/editor-save-coordinator";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("editor save coordinator", () => {
  beforeEach(() => {
    writeFileMock.mockReset();
  });

  it("finishes an in-flight save, skips queued stale saves, then reverts", async () => {
    const gate = deferred();
    const order: string[] = [];
    writeFileMock.mockImplementationOnce(async () => {
      order.push("save-start");
      await gate.promise;
      order.push("save-finish");
    });

    const firstSave = saveEditorFile("/notes/a.md", "first");
    await vi.waitFor(() => expect(writeFileMock).toHaveBeenCalledTimes(1));
    const staleSave = saveEditorFile("notes/a.md", "stale");
    const revert = runExclusiveEditorFileOperation("/notes/a.md", async () => {
      order.push("revert");
    });

    gate.resolve();

    await expect(firstSave).resolves.toBe("saved");
    await expect(staleSave).resolves.toBe("skipped");
    await revert;
    expect(order).toEqual(["save-start", "save-finish", "revert"]);
    expect(writeFileMock).toHaveBeenCalledTimes(1);
  });

  it("skips saves requested while an exclusive operation is active", async () => {
    const gate = deferred();
    const invalidated = vi.fn();
    const unsubscribe = onEditorBufferInvalidated(invalidated);
    const operation = runExclusiveEditorFileOperation(
      "/notes/b.md",
      async () => {
        await gate.promise;
      }
    );

    await expect(saveEditorFile("notes/b.md", "stale")).resolves.toBe(
      "skipped"
    );
    expect(invalidated).toHaveBeenCalledWith("/notes/b.md");
    gate.resolve();
    await operation;
    unsubscribe();
    expect(writeFileMock).not.toHaveBeenCalled();
  });
});
