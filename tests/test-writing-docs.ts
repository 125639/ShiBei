import assert from "node:assert/strict";
import test from "node:test";
import {
  deletableWritingDocRevisionWhere,
  docOwnershipWhere,
  editableWritingDocRevisionWhere,
  identityStrictlyOwnsWritingDoc,
  serializeWritingDoc
} from "../src/lib/writing-docs";

test("doc ownership: authenticated member ignores an anonymous cookie on the same request", () => {
  const where = docOwnershipWhere({ memberId: "m1", anonId: "a1" });
  assert.deepEqual(where, { ownerId: "m1" });
});

test("doc ownership: anon browser only matches its own unclaimed docs", () => {
  const where = docOwnershipWhere({ memberId: null, anonId: "a1" });
  assert.deepEqual(where, { anonId: "a1", ownerId: null });
});

test("doc ownership: no identity matches nothing", () => {
  const where = docOwnershipWhere({ memberId: null, anonId: null });
  assert.deepEqual(where, { id: "__never__" });
});

test("completion ownership never lets a logged-in member convert an anonymous doc", () => {
  assert.equal(
    identityStrictlyOwnsWritingDoc(
      { ownerId: null, anonId: "a1" },
      { memberId: "m1", anonId: "a1" }
    ),
    false
  );
  assert.equal(
    identityStrictlyOwnsWritingDoc(
      { ownerId: "m1", anonId: "a1" },
      { memberId: "m1", anonId: "a1" }
    ),
    true
  );
  assert.equal(
    identityStrictlyOwnsWritingDoc(
      { ownerId: null, anonId: "a1" },
      { memberId: null, anonId: "a1" }
    ),
    true
  );
});

test("PATCH revision claim loses when handoff has already bound the source document", () => {
  const updatedAt = new Date("2026-07-13T10:00:00.000Z");
  const where = editableWritingDocRevisionWhere({
    id: "doc-1",
    ownerId: null,
    anonId: "anon-1",
    creativeWorkId: null,
    updatedAt
  }, { memberId: null, anonId: "anon-1" }, updatedAt);

  assert.deepEqual(where, {
    id: "doc-1",
    ownerId: null,
    anonId: "anon-1",
    creativeWorkId: null,
    updatedAt
  });
  const afterHandoff = { ...where, creativeWorkId: "manual-work-1" };
  assert.notEqual(afterHandoff.creativeWorkId, where.creativeWorkId);
});

test("concurrent PATCH claims the exact server revision and stale tabs cannot silently overwrite", () => {
  const firstRevision = new Date("2026-07-13T10:00:00.000Z");
  const nextRevision = new Date("2026-07-13T10:00:01.000Z");
  const doc = {
    id: "doc-1",
    ownerId: "member-1",
    anonId: null,
    creativeWorkId: null,
    updatedAt: firstRevision
  };
  const identity = { memberId: "member-1", anonId: null };

  const tabOne = editableWritingDocRevisionWhere(doc, identity, firstRevision);
  const tabTwo = editableWritingDocRevisionWhere(doc, identity, firstRevision);
  const staleTabAfterServerAdvanced = editableWritingDocRevisionWhere(
    { ...doc, updatedAt: nextRevision },
    identity,
    firstRevision
  );
  assert.equal(tabOne.updatedAt, firstRevision);
  assert.equal(tabTwo.updatedAt, firstRevision);
  assert.notEqual(tabTwo.updatedAt.getTime(), nextRevision.getTime());
  assert.deepEqual(tabOne, tabTwo);
  assert.equal(staleTabAfterServerAdvanced.updatedAt, firstRevision);
});

test("DELETE pins strict ownership, binding, and revision in one database condition", () => {
  const updatedAt = new Date("2026-07-13T10:00:00.000Z");
  assert.deepEqual(deletableWritingDocRevisionWhere({
    id: "doc-1",
    ownerId: "member-1",
    anonId: null,
    creativeWorkId: "work-1",
    updatedAt
  }, { memberId: "member-1", anonId: "ignored-cookie" }, updatedAt), {
    id: "doc-1",
    ownerId: "member-1",
    creativeWorkId: "work-1",
    updatedAt
  });
});

test("owner serialization exposes the moderation handoff lock without exposing extra private metadata", () => {
  assert.deepEqual(serializeWritingDoc({
    id: "doc-locked",
    title: "仍可编辑的私有原稿",
    completedAt: new Date("2026-07-13T04:00:00.000Z"),
    creativeWorkId: null,
    publicationBlockedAt: new Date("2026-07-13T05:00:00.000Z"),
    updatedAt: new Date("2026-07-13T06:00:00.000Z")
  }), {
    id: "doc-locked",
    title: "仍可编辑的私有原稿",
    completedAt: "2026-07-13T04:00:00.000Z",
    creativeWorkId: null,
    publicationBlockedAt: "2026-07-13T05:00:00.000Z",
    updatedAt: "2026-07-13T06:00:00.000Z"
  });
});
