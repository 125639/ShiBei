export type PendingDocumentSave<T> = {
  docId: string;
  value: T;
};

export function createDocumentSaveCoordinator<T>(save: (docId: string, value: T) => Promise<void>) {
  const pending = new Map<string, T>();
  // Keep the newest value until it is durably saved. `pending` alone is not
  // enough: a value is removed from that map while its request is in flight,
  // which previously let document switches and pagehide handlers believe there
  // was nothing left to wait for or persist.
  const latestUnsaved = new Map<string, T>();
  const running = new Map<string, Promise<void>>();

  function enqueue(docId: string, value: T) {
    pending.set(docId, value);
    latestUnsaved.set(docId, value);
  }

  function flush(docId: string): Promise<void> {
    const existing = running.get(docId);
    if (existing) return existing;

    const drain = (async () => {
      while (pending.has(docId)) {
        const value = pending.get(docId) as T;
        pending.delete(docId);
        try {
          await save(docId, value);
          if (latestUnsaved.get(docId) === value) latestUnsaved.delete(docId);
        } catch (error) {
          if (!pending.has(docId)) pending.set(docId, value);
          throw error;
        }
      }
    });

    // A new edit can be enqueued after the drain loop observes an empty map but
    // before its promise settles. Re-check after settlement so a concurrent
    // flush cannot return successfully while that late edit remains stranded.
    const task = drain().then(
      async () => {
        if (running.get(docId) === task) running.delete(docId);
        if (pending.has(docId)) await flush(docId);
      },
      (error) => {
        if (running.get(docId) === task) running.delete(docId);
        throw error;
      }
    );

    running.set(docId, task);
    return task;
  }

  function peek(docId: string): PendingDocumentSave<T> | null {
    if (!latestUnsaved.has(docId)) return null;
    return { docId, value: latestUnsaved.get(docId) as T };
  }

  function clear(docId: string) {
    pending.delete(docId);
    latestUnsaved.delete(docId);
  }

  return { enqueue, flush, peek, clear };
}

export function isAiSelectionCurrent(snapshot: {
  docId: string;
  revision: number;
  source: string;
}, current: {
  docId: string;
  revision: number;
  selectedText: string;
}) {
  return snapshot.docId === current.docId
    && snapshot.revision === current.revision
    && snapshot.source === current.selectedText;
}
