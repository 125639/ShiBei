import assert from "node:assert/strict";
import test from "node:test";
import {
  createDocumentRecoverySnapshot,
  createDocumentSaveCoordinator,
  isAiSelectionCurrent,
  isWritingRevisionConflict,
  parseDocumentRecoverySnapshot,
  reconcileDocumentRecoveryAfterSave,
  recoverySnapshotMatchesSavedValue,
  resolveDocumentRecovery,
  shouldRestoreDocumentRecovery
} from "../src/lib/writing-client-state";

test("document saves are serialized and the latest edit wins", async () => {
  const releases: Array<() => void> = [];
  const started: string[] = [];
  const saved: string[] = [];
  const coordinator = createDocumentSaveCoordinator<string>(async (_docId, value) => {
    started.push(value);
    await new Promise<void>((resolve) => releases.push(resolve));
    saved.push(value);
  });

  coordinator.enqueue("doc-1", "old");
  const flushing = coordinator.flush("doc-1");
  await Promise.resolve();
  coordinator.enqueue("doc-1", "new");

  assert.deepEqual(started, ["old"]);
  releases.shift()?.();
  // Promise continuations may take more than one microtask depending on the
  // runtime; wait for the observable event instead of assuming scheduler order.
  while (started.length < 2) await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["old", "new"]);
  releases.shift()?.();
  await flushing;
  assert.deepEqual(saved, ["old", "new"]);
});

test("an in-flight value remains visible until the request is durable", async () => {
  let release!: () => void;
  const coordinator = createDocumentSaveCoordinator<string>(async () => {
    await new Promise<void>((resolve) => { release = resolve; });
  });

  coordinator.enqueue("doc-1", "draft");
  const flushing = coordinator.flush("doc-1");
  await Promise.resolve();

  assert.deepEqual(coordinator.peek("doc-1"), { docId: "doc-1", value: "draft" });
  release();
  await flushing;
  assert.equal(coordinator.peek("doc-1"), null);
});

test("failed pending saves stay isolated by document", async () => {
  const coordinator = createDocumentSaveCoordinator<string>(async (docId) => {
    if (docId === "doc-1") throw new Error("offline");
  });
  coordinator.enqueue("doc-1", "draft one");
  coordinator.enqueue("doc-2", "draft two");

  await assert.rejects(coordinator.flush("doc-1"), /offline/);
  await coordinator.flush("doc-2");

  assert.deepEqual(coordinator.peek("doc-1"), { docId: "doc-1", value: "draft one" });
  assert.equal(coordinator.peek("doc-2"), null);
});

test("a 409 revision conflict can be identified and discarded without an automatic retry", async () => {
  let calls = 0;
  const coordinator = createDocumentSaveCoordinator<string>(async () => {
    calls += 1;
    throw Object.assign(new Error("revision conflict"), { status: 409 });
  });
  coordinator.enqueue("doc-1", "local draft");

  await assert.rejects(coordinator.flush("doc-1"), (error: unknown) => {
    assert.equal(isWritingRevisionConflict(error), true);
    return true;
  });
  coordinator.clear("doc-1");
  assert.equal(coordinator.peek("doc-1"), null);
  await coordinator.flush("doc-1");
  assert.equal(calls, 1);
  assert.equal(isWritingRevisionConflict(Object.assign(new Error("offline"), { status: 503 })), false);
});

test("AI selection snapshots reject document, revision, or text changes", () => {
  const snapshot = { docId: "doc-1", revision: 3, source: "selected text" };
  assert.equal(isAiSelectionCurrent(snapshot, { docId: "doc-1", revision: 3, selectedText: "selected text" }), true);
  assert.equal(isAiSelectionCurrent(snapshot, { docId: "doc-2", revision: 3, selectedText: "selected text" }), false);
  assert.equal(isAiSelectionCurrent(snapshot, { docId: "doc-1", revision: 4, selectedText: "selected text" }), false);
  assert.equal(isAiSelectionCurrent(snapshot, { docId: "doc-1", revision: 3, selectedText: "changed" }), false);
});

test("large unsaved document snapshots round-trip with durable and local timestamps", () => {
  const content = "手写正文".repeat(18_000);
  assert.ok(Buffer.byteLength(content, "utf8") > 60_000);
  const snapshot = createDocumentRecoverySnapshot({
    docId: "doc-large",
    editorSessionId: "editor-a",
    value: { title: "大文稿", content },
    serverUpdatedAt: "2026-07-13T10:00:00.000Z",
    localUpdatedAt: "2026-07-13T10:00:02.000Z"
  });

  assert.deepEqual(parseDocumentRecoverySnapshot(JSON.stringify(snapshot)), snapshot);
  assert.equal(snapshot.content, content);
  assert.equal(snapshot.serverUpdatedAt, "2026-07-13T10:00:00.000Z");
  assert.equal(snapshot.localUpdatedAt, "2026-07-13T10:00:02.000Z");
});

test("only a newer recovery snapshot for the same document is restored", () => {
  const snapshot = createDocumentRecoverySnapshot({
    docId: "doc-1",
    editorSessionId: "editor-a",
    value: { title: "本地标题", content: "尚未提交的本地正文" },
    serverUpdatedAt: "2026-07-13T10:00:00.000Z",
    // Client clock is deliberately behind the server. Revision equality, not
    // cross-machine wall-clock comparison, decides this safe restore.
    localUpdatedAt: "2026-07-13T09:00:00.000Z"
  });
  const server = {
    id: "doc-1",
    title: "服务端标题",
    content: "服务端正文",
    updatedAt: "2026-07-13T10:00:00.000Z"
  };

  assert.equal(shouldRestoreDocumentRecovery(snapshot, server), true);
  assert.equal(shouldRestoreDocumentRecovery(snapshot, { ...server, id: "doc-2" }), false);
  assert.equal(
    resolveDocumentRecovery(snapshot, { ...server, updatedAt: "2026-07-13T10:00:03.000Z" }),
    "conflict"
  );
  assert.equal(
    shouldRestoreDocumentRecovery(snapshot, {
      ...server,
      title: snapshot.title,
      content: snapshot.content
    }),
    false
  );
});

test("a successful PATCH only clears the recovery value it actually saved", () => {
  const snapshot = createDocumentRecoverySnapshot({
    docId: "doc-1",
    editorSessionId: "editor-a",
    value: { title: "最新版", content: "第二次编辑" },
    serverUpdatedAt: "2026-07-13T10:00:00.000Z",
    localUpdatedAt: "2026-07-13T10:00:02.000Z"
  });

  assert.equal(
    recoverySnapshotMatchesSavedValue(snapshot, "doc-1", { title: "旧版", content: "第一次编辑" }),
    false
  );
  assert.equal(
    recoverySnapshotMatchesSavedValue(snapshot, "doc-1", { title: "最新版", content: "第二次编辑" }),
    true
  );
  assert.equal(
    recoverySnapshotMatchesSavedValue(snapshot, "doc-2", { title: "最新版", content: "第二次编辑" }),
    false
  );
  assert.equal(parseDocumentRecoverySnapshot("{broken"), null);
});

test("an older serialized PATCH rebases only its own newer recovery value", () => {
  const snapshot = createDocumentRecoverySnapshot({
    docId: "doc-1",
    editorSessionId: "editor-a",
    value: { title: "最新版", content: "第二次编辑" },
    serverUpdatedAt: "2026-07-13T10:00:00.000Z",
    localUpdatedAt: "2026-07-13T10:00:01.000Z"
  });
  const rebased = reconcileDocumentRecoveryAfterSave({
    snapshot,
    docId: "doc-1",
    editorSessionId: "editor-a",
    savedValue: { title: "旧版", content: "第一次编辑" },
    serverUpdatedAt: "2026-07-13T10:00:02.000Z"
  });
  assert.equal(rebased?.serverUpdatedAt, "2026-07-13T10:00:02.000Z");
  assert.equal(rebased?.content, "第二次编辑");

  const otherTab = reconcileDocumentRecoveryAfterSave({
    snapshot,
    docId: "doc-1",
    editorSessionId: "editor-b",
    savedValue: { title: "别的标签页", content: "服务器更新" },
    serverUpdatedAt: "2026-07-13T10:00:03.000Z"
  });
  assert.equal(otherTab, snapshot);
});
