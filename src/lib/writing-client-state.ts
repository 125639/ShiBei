export type PendingDocumentSave<T> = {
  docId: string;
  value: T;
};

export function isWritingRevisionConflict(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "status" in error
    && (error as { status?: unknown }).status === 409
  );
}

export type WritingDocumentValue = {
  title: string;
  content: string;
};

/**
 * Synchronous local fallback for edits that cannot fit in the browser's
 * roughly-64-KiB keepalive/beacon budget. `serverUpdatedAt` is the durable
 * version the editor was based on; `localUpdatedAt` records when the fallback
 * was captured for diagnostics/display, but is never compared with the server's
 * clock to resolve conflicts.
 */
export type DocumentRecoverySnapshot = WritingDocumentValue & {
  version: 1;
  docId: string;
  editorSessionId: string;
  serverUpdatedAt: string;
  localUpdatedAt: string;
};

export function createDocumentRecoverySnapshot(input: {
  docId: string;
  value: WritingDocumentValue;
  editorSessionId: string;
  serverUpdatedAt: string;
  localUpdatedAt?: string;
}): DocumentRecoverySnapshot {
  return {
    version: 1,
    docId: input.docId,
    editorSessionId: input.editorSessionId,
    title: input.value.title,
    content: input.value.content,
    serverUpdatedAt: input.serverUpdatedAt,
    localUpdatedAt: input.localUpdatedAt ?? new Date().toISOString()
  };
}

export function parseDocumentRecoverySnapshot(raw: string | null): DocumentRecoverySnapshot | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DocumentRecoverySnapshot>;
    if (
      value.version !== 1
      || typeof value.docId !== "string"
      || !value.docId
      || typeof value.editorSessionId !== "string"
      || !value.editorSessionId
      || typeof value.title !== "string"
      || typeof value.content !== "string"
      || typeof value.serverUpdatedAt !== "string"
      || typeof value.localUpdatedAt !== "string"
      || !Number.isFinite(Date.parse(value.serverUpdatedAt))
      || !Number.isFinite(Date.parse(value.localUpdatedAt))
    ) return null;
    return value as DocumentRecoverySnapshot;
  } catch {
    return null;
  }
}

export function shouldRestoreDocumentRecovery(
  snapshot: DocumentRecoverySnapshot,
  server: WritingDocumentValue & { id: string; updatedAt: string }
) {
  return resolveDocumentRecovery(snapshot, server) === "restore";
}

export type DocumentRecoveryResolution = "restore" | "conflict" | "discard" | "unrelated";

export function resolveDocumentRecovery(
  snapshot: DocumentRecoverySnapshot,
  server: WritingDocumentValue & { id: string; updatedAt: string }
): DocumentRecoveryResolution {
  if (snapshot.docId !== server.id) return "unrelated";
  if (snapshot.title === server.title && snapshot.content === server.content) return "discard";
  // updatedAt is the server-issued revision token. Equality proves that the
  // local edit was made from the version just fetched, regardless of clock skew.
  // A different token is ambiguous (another tab or a late old PATCH), so the UI
  // must ask instead of deleting or automatically overwriting either version.
  return snapshot.serverUpdatedAt === server.updatedAt ? "restore" : "conflict";
}

export function reconcileDocumentRecoveryAfterSave(input: {
  snapshot: DocumentRecoverySnapshot | null;
  docId: string;
  editorSessionId: string;
  savedValue: WritingDocumentValue;
  serverUpdatedAt: string;
}): DocumentRecoverySnapshot | null {
  const { snapshot } = input;
  if (!snapshot || snapshot.docId !== input.docId) return snapshot;
  if (recoverySnapshotMatchesSavedValue(snapshot, input.docId, input.savedValue)) return null;
  // Only the tab that created this recovery value may advance its base. A PATCH
  // from another tab must leave it untouched so the next open becomes an
  // explicit conflict instead of silently treating unrelated edits as merged.
  if (snapshot.editorSessionId !== input.editorSessionId) return snapshot;
  return { ...snapshot, serverUpdatedAt: input.serverUpdatedAt };
}

export function recoverySnapshotMatchesSavedValue(
  snapshot: DocumentRecoverySnapshot | null,
  docId: string,
  value: WritingDocumentValue
) {
  return Boolean(
    snapshot
    && snapshot.docId === docId
    && snapshot.title === value.title
    && snapshot.content === value.content
  );
}

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
