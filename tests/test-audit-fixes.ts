import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import test from "node:test";
import type IORedis from "ioredis";
import { withInFlightLock } from "../src/lib/in-flight";
import { waitForRedisReady } from "../src/lib/redis-ready";
import { withEvaluateTimeout } from "../src/lib/scrape-timeout";
import { localizedAlternates } from "../src/lib/language";
import { readBoundedText } from "../src/lib/request-validation";
import { scoreCreativeWorkFallback } from "../src/lib/creation-ai";
import { canPublishWork, isFallbackScoreDetail } from "../src/lib/creation";
import { commentCursorWhere, encodeCommentCursor, parseCommentCursor } from "../src/lib/comment-pagination";

const source = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

class FakeRedis extends EventEmitter {
  status = "wait";
  connectCalls = 0;
  commands = 0;
  fail = false;
  values = new Map<string, string>();
  async connect() {
    this.connectCalls++;
    this.status = "connecting";
    await new Promise((resolve) => setTimeout(resolve, 10));
    this.status = "ready";
    this.emit("ready");
  }
  async set(key: string, token: string) {
    assert.equal(this.status, "ready");
    this.commands++;
    if (this.fail) throw new Error("connection lost");
    if (this.values.has(key)) return null;
    this.values.set(key, token);
    return "OK";
  }
  async eval(_lua: string, _count: number, key: string, token: string) {
    if (this.values.get(key) === token) this.values.delete(key);
  }
}

test("Redis cold start is coalesced and paid work never falls back after Redis failure", async () => {
  const globals = globalThis as unknown as { shibeiInFlightRedis?: IORedis };
  const previous = globals.shibeiInFlightRedis;
  const previousUrl = process.env.REDIS_URL;
  const fake = new FakeRedis();
  globals.shibeiInFlightRedis = fake as unknown as IORedis;
  process.env.REDIS_URL = "redis://test.invalid";
  try {
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const run = () => withInFlightLock("same-work", 60, async () => { calls++; started(); await gate; return 42; });
    const first = run();
    const second = run();
    await entered;
    assert.deepEqual(await second, { ok: false, reason: "busy" });
    release();
    assert.deepEqual(await first, { ok: true, value: 42 });
    assert.equal(calls, 1);
    assert.equal(fake.connectCalls, 1);
    await assert.rejects(withInFlightLock("throws", 60, async () => { calls++; throw new Error("business failure"); }), /business failure/);
    assert.equal(calls, 2, "business failures must never rerun the operation");
    fake.fail = true;
    assert.deepEqual(await withInFlightLock("unavailable", 60, async () => { calls++; }), { ok: false, reason: "unavailable" });
    assert.equal(calls, 2);
  } finally {
    globals.shibeiInFlightRedis = previous;
    if (previousUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousUrl;
  }
});

test("Redis readiness has a bounded wait and removes listeners", async () => {
  const fake = new FakeRedis();
  fake.status = "connecting";
  await assert.rejects(waitForRedisReady(fake as unknown as IORedis, 5), /timed out/);
  assert.equal(fake.listenerCount("ready"), 0);
  assert.equal(fake.listenerCount("error"), 0);
  assert.match(source("src/lib/in-flight.ts"), /status === "end"/);
});

test("a stuck page evaluation times out and a healthy one returns", async () => {
  assert.equal(await withEvaluateTimeout(Promise.resolve(7), 50), 7);
  await assert.rejects(withEvaluateTimeout(new Promise(() => {}), 5), /页面脚本执行超时/);
  assert.match(source("src/lib/scrape-audience.ts"), /withEvaluateTimeout\(page\.evaluate/);
});

test("fallback scores are below every genre threshold, including personal narrative", () => {
  for (const threshold of [1, 50, 65, 70, 95]) {
    const score = scoreCreativeWorkFallback({ threshold, depth: "FULL", content: ("充分的正文细节。".repeat(200) + "\n\n").repeat(8), dimensions: [{ key: "quality", label: "质量", hint: "", weight: 1 }] });
    assert.ok(score.total < threshold);
  }
  assert.equal(isFallbackScoreDetail(JSON.stringify({ fallback: true })), true);
  assert.equal(isFallbackScoreDetail(JSON.stringify({ overallComment: "AI 评审服务暂时不可用，本次只完成了保守的结构预检，未把临时检查冒充正式 AI 评分。" })), true);
  const gate = canPublishWork({ scoreDetail: '{"fallback":true}', score: 90, threshold: 65, scoredHash: "old", scoredRubricHash: "rubric", currentRubricHash: "rubric", title: "title", summary: "summary", content: "content" });
  assert.equal(gate.ok, false);
  const route = source("src/app/api/public/creation/works/[id]/score/route.ts");
  assert.match(route, /score: scoreFallback \? null : result.total/);
  assert.match(route, /scoredHash: scoreFallback \? null/);
});

test("localized canonical paths and language maps are consistent", () => {
  for (const path of ["/stats", "/account", "/write", "/create", "/settings", "/community/example"]) {
    assert.deepEqual(localizedAlternates("en", path), {
      canonical: `/en${path}`,
      languages: { "zh-CN": `/zh${path}`, en: `/en${path}`, "x-default": `/zh${path}` }
    });
  }
  assert.match(source("src/app/api/admin/settings/site/route.ts"), /revalidatePath\("\/\[lang\]", "layout"\)/);
  assert.match(source("src/app/api/public/posts/[id]/translate/route.ts"), /publicRevalidationPaths\(\[/);
});

test("bulk form keeps successful controls enabled when visual controls are disabled", () => {
  const form = source("src/components/BulkPostActions.tsx");
  assert.match(form, /type="hidden" name="action" value=\{action\}/);
  assert.match(form, /activeSelectedIds\.map\(.*type="hidden" name="postId" value=\{id\}/);
  assert.equal((form.match(/name="postId"/g) || []).length, 1);
  assert.equal((form.match(/name="action"/g) || []).length, 1);
});

test("container ports cannot inherit the host port and update pulls are forced", () => {
  for (const file of ["docker-compose.yml", "docker-compose.backend.yml", "docker-compose.frontend.yml"]) {
    assert.match(source(file), /PORT: "3000"/);
    assert.match(source(file), /APP_PORT: "3000"/);
  }
  assert.match(source("scripts/init.sh"), /pull --policy always/);
  assert.match(source("scripts/updater/server.mjs"), /"pull", "--policy", "always"/);
  assert.match(source("scripts/updater/server.mjs"), /process\.kill\(-child\.pid, "SIGKILL"\)/);
});

test("bounded response reading handles chunked overflow and invalid UTF8", async () => {
  assert.equal(await readBoundedText(new Response("ok"), 2), "ok");
  assert.equal(await readBoundedText(new Response("oversized"), 3), null);
  assert.equal(await readBoundedText(new Response(new Uint8Array([0xff])), 4), null);
  assert.match(source("src/lib/exa.ts"), /readBoundedText\(res, 2 \* 1024 \* 1024\)/);
  assert.match(source("src/app/api/admin/login/route.ts"), /readBoundedText\(request, maxBytes\)/);
});

test("comment keyset cursor survives deletions and ties without an offset", () => {
  const row = { id: "comment-200", createdAt: new Date("2026-10-07T00:00:00Z") };
  assert.deepEqual(parseCommentCursor(encodeCommentCursor(row)), row);
  assert.deepEqual(commentCursorWhere(row), { OR: [{ createdAt: { gt: row.createdAt } }, { createdAt: row.createdAt, id: { gt: row.id } }] });
  assert.deepEqual(commentCursorWhere(null), {});
  assert.throws(() => parseCommentCursor("broken"));
  assert.throws(() => parseCommentCursor("A".repeat(513)));
});

test("sensitive mutations and data paths retain their guards", () => {
  assert.match(source("src/app/api/admin/settings/admin/route.ts"), /bcrypt\.compare\(currentPassword, admin.passwordHash\)/);
  assert.match(source("src/app/api/public/creation/works/[id]/answer/route.ts"), /withInFlightLock\(`creation-answer:/);
  assert.match(source("src/lib/stats.ts"), /new Date\(todayStart.getTime\(\) - 29 \* DAY_MS\)/);
  assert.match(source("src/lib/ai.ts"), /typeof parsed\?\.content !== "string"/);
  assert.doesNotMatch(source("src/app/api/admin/videos/delete/route.ts"), /SELECT "id" FROM "Post" ORDER BY "id" FOR UPDATE/);
});

test("cron uses the site calendar rather than the process timezone", async () => {
  const { siteScheduleTimeZone } = await import("../src/lib/site-time");
  const { default: parser } = await import("cron-parser");
  const previous = process.env.SITE_UTC_OFFSET_MINUTES;
  try {
    delete process.env.SITE_UTC_OFFSET_MINUTES;
    assert.equal(siteScheduleTimeZone(), "UTC+08:00");
    const next = parser.parseExpression("0 9 * * *", { tz: siteScheduleTimeZone(), currentDate: new Date("2026-10-07T00:00:00Z") }).next();
    assert.equal(next.toISOString(), "2026-10-07T01:00:00.000Z");
    process.env.SITE_UTC_OFFSET_MINUTES = "330";
    assert.equal(siteScheduleTimeZone(), "UTC+05:30");
  } finally {
    if (previous === undefined) delete process.env.SITE_UTC_OFFSET_MINUTES;
    else process.env.SITE_UTC_OFFSET_MINUTES = previous;
  }
});

test("login identities do not collide and verified success resets failure budgets", async () => {
  const { checkRateLimit, checkSubjectRateLimit, resetLoginFailureLimits } = await import("../src/lib/rate-limit");
  const previous = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  const request = new Request("http://localhost/login");
  const common = { namespace: "audit-login", request, limit: 1, windowSec: 60 };
  try {
    assert.equal((await checkSubjectRateLimit({ ...common, subject: "a@b.test" })).ok, true);
    assert.equal((await checkSubjectRateLimit({ ...common, subject: "a_b.test" })).ok, true);
    assert.equal((await checkRateLimit({ ...common, subject: "a@b.test" })).ok, true);
    await resetLoginFailureLimits({ ...common, subject: "a@b.test" });
    assert.equal((await checkSubjectRateLimit({ ...common, subject: "a@b.test" })).ok, true);
    assert.equal((await checkRateLimit({ ...common, subject: "a@b.test" })).ok, true);
    assert.equal((await checkSubjectRateLimit({ ...common, subject: "a_b.test" })).ok, false);
  } finally {
    if (previous !== undefined) process.env.REDIS_URL = previous;
  }
});
