import assert from "node:assert/strict";
import test from "node:test";
import {
  inviteCodeForAdmin,
  normalizeLegacyInvitePasswordCandidate,
  retiredInviteCode
} from "../src/lib/invite-codes";
import {
  memberPasswordProblem,
  publicMemberRegistrationEnabled
} from "../src/lib/member-credentials";

test("member passwords require length and three character classes", () => {
  assert.match(memberPasswordProblem("Ab1!short") || "", /至少 12 位/);
  assert.match(memberPasswordProblem("onlylowercasepassword") || "", /至少三类/);
  assert.equal(memberPasswordProblem("Long-Safe-Password-2026"), null);
  assert.match(
    memberPasswordProblem("Alice-Safe-Password-2026", "alice") || "",
    /不能包含账号名/
  );
});

test("used and revoked invite codes are never serialized to administrators", () => {
  const source = "SB-ABCD-2345";
  assert.equal(inviteCodeForAdmin("UNUSED", source), source);
  assert.equal(inviteCodeForAdmin("USED", source), null);
  assert.equal(inviteCodeForAdmin("REVOKED", source), null);
  assert.equal(inviteCodeForAdmin("UNUSED", retiredInviteCode("invite-id", "USED")), null);
  assert.equal(retiredInviteCode("invite-id", "USED"), "__RETIRED_USED_invite-id");
  assert.equal(retiredInviteCode("invite-id", "REVOKED"), "__RETIRED_REVOKED_invite-id");
});

test("legacy invite password candidates normalize equivalent code spellings", () => {
  const canonical = "SB-ABCD-2345";
  assert.equal(normalizeLegacyInvitePasswordCandidate(canonical), canonical);
  assert.equal(normalizeLegacyInvitePasswordCandidate("sb-abcd-2345"), canonical);
  assert.equal(normalizeLegacyInvitePasswordCandidate("SBABCD2345"), canonical);
  assert.equal(normalizeLegacyInvitePasswordCandidate("  sb abcd 2345  "), canonical);
  assert.equal(normalizeLegacyInvitePasswordCandidate("Long-Safe-Password-2026"), null);
});

test("public email registration is closed unless the exact feature flag is enabled", () => {
  const previous = process.env.ALLOW_PUBLIC_MEMBER_REGISTRATION;
  try {
    delete process.env.ALLOW_PUBLIC_MEMBER_REGISTRATION;
    assert.equal(publicMemberRegistrationEnabled(), false);
    process.env.ALLOW_PUBLIC_MEMBER_REGISTRATION = "false";
    assert.equal(publicMemberRegistrationEnabled(), false);
    process.env.ALLOW_PUBLIC_MEMBER_REGISTRATION = "TRUE";
    assert.equal(publicMemberRegistrationEnabled(), false);
    process.env.ALLOW_PUBLIC_MEMBER_REGISTRATION = "true";
    assert.equal(publicMemberRegistrationEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env.ALLOW_PUBLIC_MEMBER_REGISTRATION;
    else process.env.ALLOW_PUBLIC_MEMBER_REGISTRATION = previous;
  }
});
