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

test("visit path normalization only accepts known public route shapes", () => {
  // 每个静态公开路由都可统计
  for (const path of ["/", "/posts", "/news", "/community", "/create", "/write", "/stats", "/about", "/settings", "/account"]) {
    assert.equal(normalizeVisitPath(path), path, `静态路由应可统计: ${path}`);
  }
  // 带 slug 的三条路由可统计
  assert.equal(normalizeVisitPath("/news/some-slug"), "/news/some-slug");
  assert.equal(normalizeVisitPath("/community/some-slug"), "/community/some-slug");

  // 任意路径不再各占一行——这正是把公开埋点变成无认证建表原语的入口
  assert.equal(normalizeVisitPath("/not-a-real-route"), null);
  assert.equal(normalizeVisitPath("/posts/a/b"), null, "多余层级不该通过");
  assert.equal(normalizeVisitPath("/settings/anything"), null, "静态路由不接受子路径");
  assert.equal(normalizeVisitPath(`/posts/${"s".repeat(200)}`), null, "slug 超长应拒绝");
});

test("visit paths collapse language prefixes onto one row per article", () => {
  // /zh 与 /en 归并：看板要的是每篇文章的热度，不是每语种每篇
  assert.equal(normalizeVisitPath("/zh/posts/hello"), "/posts/hello");
  assert.equal(normalizeVisitPath("/en/posts/hello"), "/posts/hello");
  assert.equal(normalizeVisitPath("/zh"), "/");
  assert.equal(normalizeVisitPath("/en"), "/");
  assert.equal(normalizeVisitPath("/en/stats"), "/stats");
  // 同前缀单词不该被当成语言段
  assert.equal(normalizeVisitPath("/enigma"), null);
});

test("visit day key buckets by CST (+8) day", () => {
  // UTC 2026-07-09 17:00 = 北京时间 2026-07-10 01:00 → 应记入 07-10
  assert.equal(visitDayKey(new Date("2026-07-09T17:00:00.000Z")), "2026-07-10");
  assert.equal(visitDayKey(new Date("2026-07-09T15:59:59.000Z")), "2026-07-09");
});
