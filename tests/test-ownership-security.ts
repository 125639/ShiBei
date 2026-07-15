import assert from "node:assert/strict";
import test from "node:test";
import { actorOwnsWork } from "../src/lib/creation-server";
import { docOwnershipWhere } from "../src/lib/writing-docs";

test("direct API bypass: member identity never falls back to a matching anon cookie", () => {
  const anonymousWork = { ownerId: null, anonId: "victim-anon" };
  const loggedInAttacker = { memberId: "attacker", anonId: "victim-anon" };

  assert.equal(actorOwnsWork(anonymousWork, loggedInAttacker), false);
  assert.deepEqual(docOwnershipWhere(loggedInAttacker), { ownerId: "attacker" });
});

test("anonymous identity only owns an unclaimed work with the exact same token", () => {
  const anonymousWork = { ownerId: null, anonId: "victim-anon" };

  assert.equal(actorOwnsWork(anonymousWork, { memberId: null, anonId: "victim-anon" }), true);
  assert.equal(actorOwnsWork(anonymousWork, { memberId: null, anonId: "other-anon" }), false);
  assert.equal(actorOwnsWork(anonymousWork, { memberId: null, anonId: null }), false);
});

test("second user cannot take or operate the first member's work via its old anon token", () => {
  const firstUsersWork = { ownerId: "member-a", anonId: null };

  assert.equal(actorOwnsWork(firstUsersWork, { memberId: "member-a", anonId: null }), true);
  assert.equal(actorOwnsWork(firstUsersWork, { memberId: "member-b", anonId: "victim-anon" }), false);
  assert.equal(actorOwnsWork(firstUsersWork, { memberId: null, anonId: "victim-anon" }), false);
});

test("malformed dual-identity records do not let the anonymous side bypass account ownership", () => {
  const legacyDualIdentity = { ownerId: "member-a", anonId: "legacy-anon" };

  assert.equal(actorOwnsWork(legacyDualIdentity, { memberId: null, anonId: "legacy-anon" }), false);
  assert.equal(actorOwnsWork(legacyDualIdentity, { memberId: "member-b", anonId: "legacy-anon" }), false);
});
