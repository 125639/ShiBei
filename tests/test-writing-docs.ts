import assert from "node:assert/strict";
import test from "node:test";
import { docOwnershipWhere } from "../src/lib/writing-docs";

test("doc ownership: member sees own docs plus this browser's unclaimed anon docs", () => {
  const where = docOwnershipWhere({ memberId: "m1", anonId: "a1" });
  assert.deepEqual(where, { OR: [{ ownerId: "m1" }, { anonId: "a1", ownerId: null }] });
});

test("doc ownership: anon browser only matches its own unclaimed docs", () => {
  const where = docOwnershipWhere({ memberId: null, anonId: "a1" });
  assert.deepEqual(where, { OR: [{ anonId: "a1", ownerId: null }] });
});

test("doc ownership: no identity matches nothing", () => {
  const where = docOwnershipWhere({ memberId: null, anonId: null });
  assert.deepEqual(where, { id: "__never__" });
});
