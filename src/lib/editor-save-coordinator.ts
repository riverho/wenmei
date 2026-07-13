import { reviewCaptureVersion, writeFile } from "@/lib/tauri-bridge";

type SaveResult = "saved" | "skipped";

interface PathQueue {
  tail: Promise<void>;
  generation: number;
  exclusiveDepth: number;
}

const queues = new Map<string, PathQueue>();
const invalidationListeners = new Set<(path: string) => void>();

function queueKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function getQueue(path: string): PathQueue {
  const key = queueKey(path);
  let queue = queues.get(key);
  if (!queue) {
    queue = {
      tail: Promise.resolve(),
      generation: 0,
      exclusiveDepth: 0,
    };
    queues.set(key, queue);
  }
  return queue;
}

export function editorPathsMatch(
  first: string | null,
  second: string | null
): boolean {
  return queueKey(first ?? "") === queueKey(second ?? "");
}

export function onEditorBufferInvalidated(
  listener: (path: string) => void
): () => void {
  invalidationListeners.add(listener);
  return () => {
    invalidationListeners.delete(listener);
  };
}

function enqueue<T>(queue: PathQueue, operation: () => Promise<T>): Promise<T> {
  const result = queue.tail.catch(() => undefined).then(operation);
  queue.tail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export function saveEditorFile(
  path: string,
  content: string,
  captureVersion = false
): Promise<SaveResult> {
  const queue = getQueue(path);
  const generation = queue.generation;

  if (queue.exclusiveDepth > 0) {
    return Promise.resolve("skipped");
  }

  return enqueue(queue, async () => {
    if (queue.exclusiveDepth > 0 || generation !== queue.generation) {
      return "skipped";
    }
    await writeFile(path, content, "human");
    if (captureVersion) {
      await reviewCaptureVersion(path);
    }
    return "saved";
  });
}

export async function runExclusiveEditorFileOperation<T>(
  path: string,
  operation: () => Promise<T>
): Promise<T> {
  const queue = getQueue(path);
  queue.generation += 1;
  queue.exclusiveDepth += 1;
  invalidationListeners.forEach(listener => listener(path));

  try {
    return await enqueue(queue, operation);
  } finally {
    queue.exclusiveDepth -= 1;
  }
}
