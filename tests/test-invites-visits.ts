import assert from "node:assert/strict";
import test from "node:test";
import { generateInviteCode, isInviteCodeFormat, normalizeInviteCodeInput } from "../src/lib/invite-codes";
import { normalizeVisitPath, visitDayKey } from "../src/lib/visits";

test("invite codes match the unambiguous format and vary", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const code = generateInviteCode();
    assert.ok(isInviteCodeFormat(code), `格式不符: ${code}`);
    assert.ok(!/[01OIL]/.test(code.slice(3)), `含易混字符: ${code}`);
    seen.add(code);
  }
  assert.ok(seen.size >= 199, "200 个码几乎不该有碰撞");
});

test("invite code input normalization tolerates case and missing hyphens", () => {
  assert.equal(normalizeInviteCodeInput("sb-abcd-2345"), "SB-ABCD-2345");
  assert.equal(normalizeInviteCodeInput("SBABCD2345"), "SB-ABCD-2345");
  assert.equal(normalizeInviteCodeInput("  sb abcd 2345  "), "SB-ABCD-2345");
  // 不像邀请码的输入只做去空白+大写,不强行改形
  assert.equal(normalizeInviteCodeInput("my-password"), "MY-PASSWORD");
});

test("visit path normalization keeps clean public paths and rejects junk", () => {
  assert.equal(normalizeVisitPath("/"), "/");
  assert.equal(normalizeVisitPath("/posts/hello-world"), "/posts/hello-world");
  assert.equal(normalizeVisitPath("/posts/hello?utm=1#top"), "/posts/hello");
  assert.equal(normalizeVisitPath("//posts///a/"), "/posts/a");
  assert.equal(normalizeVisitPath("/admin/stats"), null);
  assert.equal(normalizeVisitPath("/api/public/visit"), null);
  assert.equal(normalizeVisitPath("/_next/static/x.js"), null);
  assert.equal(normalizeVisitPath("/uploads/video/a.mp4"), null);
  assert.equal(normalizeVisitPath("no-leading-slash"), null);
  assert.equal(normalizeVisitPath(`/${"x".repeat(300)}`), null);
  assert.equal(normalizeVisitPath('/a"b'), null);
  assert.equal(normalizeVisitPath(123), null);
});

test("visit day key buckets by CST (+8) day", () => {
  // UTC 2026-07-09 17:00 = 北京时间 2026-07-10 01:00 → 应记入 07-10
  assert.equal(visitDayKey(new Date("2026-07-09T17:00:00.000Z")), "2026-07-10");
  assert.equal(visitDayKey(new Date("2026-07-09T15:59:59.000Z")), "2026-07-09");
});
