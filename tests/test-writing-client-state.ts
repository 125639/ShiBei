import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentSaveCoordinator, isAiSelectionCurrent } from "../src/lib/writing-client-state";

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

test("AI selection snapshots reject document, revision, or text changes", () => {
  const snapshot = { docId: "doc-1", revision: 3, source: "selected text" };
  assert.equal(isAiSelectionCurrent(snapshot, { docId: "doc-1", revision: 3, selectedText: "selected text" }), true);
  assert.equal(isAiSelectionCurrent(snapshot, { docId: "doc-2", revision: 3, selectedText: "selected text" }), false);
  assert.equal(isAiSelectionCurrent(snapshot, { docId: "doc-1", revision: 4, selectedText: "selected text" }), false);
  assert.equal(isAiSelectionCurrent(snapshot, { docId: "doc-1", revision: 3, selectedText: "changed" }), false);
});
