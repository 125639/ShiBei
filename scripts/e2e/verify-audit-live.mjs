/**
 * Real browser/HTTP/PostgreSQL/Redis regression run in disposable local services.
 * No production DATABASE_URL, Redis, account, upload, or paid model is used.
 * Run: node scripts/e2e/verify-audit-live.mjs
 * Requires local initdb/pg_ctl, redis-server, and Playwright Chromium.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import net from "node:net";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import Redis from "ioredis";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "test-results", `audit-live-${stamp}`);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "shibei-audit-live-"));
const pgBin = process.env.AUDIT_PG_BIN || "/usr/lib/postgresql/18/bin";
const dist = `.next-live-audit-${process.pid}`;
const beforeNextEnv = await fs.readFile(path.join(root, "next-env.d.ts"));
await fs.mkdir(output, { recursive: true });
await fs.mkdir(path.join(temporary, "socket"));
const checks = [];
const pageErrors = [];
let pgStarted = false;
let web;
let redisProcess;
let browser;
let database;
let redis;
let currentPage;
let failed = false;
const children = new Set();

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
const pgPort = await freePort();
const redisPort = await freePort();
const webPort = await freePort();
const updaterPort = await freePort();
// Update/GitHub probing is unrelated to these tests; block it at a local stub.
const updaterStub = http.createServer((_request, response) => {
  response.writeHead(503, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: "Updates disabled in isolated runtime audit" }));
});
const base = `http://127.0.0.1:${webPort}`;
const adminPassword = `Audit!${crypto.randomBytes(12).toString("hex")}Z9`;
const memberPassword = `Member!${crypto.randomBytes(12).toString("hex")}Z9`;
const env = {
  ...process.env,
  NODE_ENV: "production", NODE_OPTIONS: "--max-old-space-size=1536",
  DATABASE_URL: `postgresql://audit@127.0.0.1:${pgPort}/audit?schema=public`,
  REDIS_URL: `redis://127.0.0.1:${redisPort}/0`,
  AUTH_SECRET: crypto.randomBytes(32).toString("hex"),
  ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"),
  PUBLIC_URL: base, APP_MODE: "full", APP_HOST: "127.0.0.1", PORT: String(webPort),
  TRUST_PROXY_HOPS: "0", SHIBEI_DIST_DIR: dist,
  UPDATER_URL: `http://127.0.0.1:${updaterPort}`, UPDATER_TOKEN: crypto.randomBytes(32).toString("hex"),
  ADMIN_USERNAME: "audit-admin", ADMIN_PASSWORD: adminPassword,
  INIT_AI_PROVIDER: "", INIT_AI_API_KEY: "", ALLOW_LIVE_WRITE: "1", BASE_URL: base, AUDIT_LIVE_ISOLATED: "1"
};

function start(command, args, label, overrides = {}) {
  const child = spawn(command, args, { cwd: root, env: { ...env, ...overrides }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  children.add(child);
  const log = createWriteStream(path.join(output, `${label}.log`), { flags: "a" });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once("close", () => { children.delete(child); log.end(); });
  return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolve) => child.once("close", resolve));
  try { process.kill(-child.pid, "SIGTERM"); } catch { return; }
  const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 8_000);
  try { await closed; } finally { clearTimeout(timer); }
}
async function run(command, args, label, overrides = {}, expected = 0) {
  const child = start(command, args, label, overrides);
  const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 240_000);
  try {
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(code, expected, `${label} failed; inspect ${path.join(output, `${label}.log`)}`);
  } finally { clearTimeout(timer); }
}
async function check(name, fn) {
  const startAt = Date.now();
  await fn();
  checks.push({ name, passed: true, elapsedMs: Date.now() - startAt });
  console.log(`PASS ${name} (${Date.now() - startAt}ms)`);
}
async function startWeb() {
  web = start(process.execPath, ["scripts/trusted-next-server.mjs"], "web");
  for (let i = 0; i < 120; i++) {
    if (web.exitCode !== null) throw new Error("Web server exited; inspect web.log");
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Web server readiness timeout");
}
async function newContext() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    return url.startsWith(`${base}/`) || /^(data|blob):/.test(url) ? route.continue() : route.abort();
  });
  context.on("page", (page) => page.on("pageerror", (error) => pageErrors.push({ url: page.url(), message: error.message })));
  return context;
}
async function adminLogin(context, username = env.ADMIN_USERNAME, password = adminPassword) {
  const page = await context.newPage();
  currentPage = page;
  await page.goto(`${base}/admin/login`, { waitUntil: "networkidle" });
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([page.waitForURL(`${base}/admin`), page.locator('button[type="submit"]').click()]);
  return page;
}
const requestOptions = { headers: { Origin: base }, maxRedirects: 0, timeout: 15_000 };

try {
  await new Promise((resolve, reject) => { updaterStub.once("error", reject); updaterStub.listen(updaterPort, "127.0.0.1", resolve); });
  console.log(`Artifacts: ${output}`);
  console.log("Starting isolated PostgreSQL and Redis; production services are not used.");
  await run(path.join(pgBin, "initdb"), ["-D", path.join(temporary, "pg"), "-U", "audit", "--auth=trust", "--encoding=UTF8", "--no-locale"], "initdb");
  await run(path.join(pgBin, "pg_ctl"), ["-D", path.join(temporary, "pg"), "-l", path.join(output, "postgres.log"), "-o", `-h 127.0.0.1 -p ${pgPort} -k ${path.join(temporary, "socket")}`, "-w", "start"], "pg-start");
  pgStarted = true;
  await run(path.join(pgBin, "createdb"), ["-h", "127.0.0.1", "-p", String(pgPort), "-U", "audit", "audit"], "createdb");
  redisProcess = start("redis-server", ["--bind", "127.0.0.1", "--port", String(redisPort), "--save", "", "--appendonly", "no", "--dir", temporary], "redis");
  redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  redis.on("error", () => undefined);
  await redis.ping();
  await check("真实 Redis 多进程去重、断连重建、故障拒绝及 Chromium 死循环超时", () => run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/e2e/verify-audit-runtime.ts"], "runtime-faults"));
  await check("全部迁移在空 PostgreSQL 数据库实际执行", () => run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], "migrations"));
  database = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  await check("首次 seed 拒绝公开默认密码，不创建管理员", async () => {
    await run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"], "seed-default-denied", { ADMIN_PASSWORD: "change-me-now" }, 1);
    assert.equal(await database.adminUser.count(), 0);
  });
  await run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"], "seed");
  await database.siteSettings.update({ where: { id: "site" }, data: { commentsEnabled: true, videosEnabled: true, contentLanguageMode: "bilingual", exaEnabled: false, autoImageSearchEnabled: false, name: "Audit Live Before" } });
  const member = await database.memberUser.create({ data: { username: "audit-member", displayName: "隔离测试会员", passwordHash: await bcrypt.hash(memberPassword, 12) } });
  const publicPost = await database.post.create({ data: { slug: "audit-live-comments", title: "实际运行：评论分页验证", titleEn: "Live comment pagination", summary: "隔离数据库里的验收文章", content: "# 实际运行\n\n此文仅存在于独立测试数据库。", status: "PUBLISHED", publishedAt: new Date() } });
  await database.comment.createMany({ data: Array.from({ length: 205 }, (_, index) => ({ id: `audit-comment-${String(index).padStart(3, "0")}`, postId: publicPost.id, memberId: member.id, content: `实际测试评论 ${String(index).padStart(3, "0")}`, createdAt: new Date("2026-10-07T00:00:00Z") })) });
  const bulkPosts = await Promise.all([0, 1].map((index) => database.post.create({ data: { slug: `audit-bulk-${index}`, title: `AuditBulkMarker ${index}`, summary: "批量操作验收", content: "独立测试正文", status: "PUBLISHED", publishedAt: new Date() } })));
  await check("修复后的代码使用隔离环境完成生产构建", () => run("npm", ["run", "build"], "build"));
  await startWeb();
  browser = await chromium.launch({ headless: true });
  const adminContext = await newContext();
  const adminPage = await adminLogin(adminContext);
  const authSnapshot = await adminContext.storageState();

  await check("浏览器原生批量提交：转草稿、归档、删除均落库", async () => {
    adminPage.on("dialog", (dialog) => dialog.accept());
    for (const action of ["draft", "archive", "delete"]) {
      await adminPage.goto(`${base}/admin/posts?q=AuditBulkMarker`, { waitUntil: "networkidle" });
      const form = adminPage.locator('form[action="/api/admin/posts/bulk"]');
      for (const post of bulkPosts) await form.locator(`input[type="checkbox"][value="${post.id}"]`).check();
      await form.locator("select").selectOption(action);
      const delivered = adminPage.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/api/admin/posts/bulk"));
      const response = adminPage.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/admin/posts/bulk"));
      await form.locator('button[type="submit"]').click();
      const posted = await delivered;
      const values = new URLSearchParams(posted.postData());
      assert.equal(values.get("action"), action);
      assert.deepEqual(values.getAll("postId").sort(), bulkPosts.map((post) => post.id).sort());
      assert.ok([303, 307].includes((await response).status()));
      await adminPage.waitForLoadState("networkidle");
      const rows = await database.post.findMany({ where: { id: { in: bulkPosts.map((post) => post.id) } } });
      if (action === "delete") assert.equal(rows.length, 0);
      else assert.ok(rows.every((post) => post.status === (action === "draft" ? "DRAFT" : "ARCHIVED")));
    }
    await adminPage.screenshot({ path: path.join(output, "admin-bulk.png") });
  });

  const publicContext = await newContext();
  const publicPage = await publicContext.newPage();
  currentPage = publicPage;
  await check("真实 Chromium：205 条评论可加载完整，同时间游标无重复", async () => {
    await publicPage.goto(`${base}/zh/posts/${publicPost.slug}`, { waitUntil: "networkidle" });
    await publicPage.locator(".comment-item").first().waitFor();
    assert.equal(await publicPage.locator(".comment-item").count(), 200);
    await publicPage.getByRole("button", { name: "加载更多评论" }).click();
    await publicPage.getByText("实际测试评论 204", { exact: true }).waitFor();
    assert.equal(await publicPage.locator(".comment-item").count(), 205);
    assert.equal(new Set(await publicPage.locator(".comment-body").allTextContents()).size, 205);
    await publicPage.locator(".post-comments").scrollIntoViewIfNeeded();
    await publicPage.screenshot({ path: path.join(output, "comments-pagination.png") });
  });
  await check("保存站点设置后中英文 ISR 页面立即使用新站名", async () => {
    const paths = ["/zh/about", "/en/about", `/zh/posts/${publicPost.slug}`, `/en/posts/${publicPost.slug}`];
    for (const route of paths) assert.match(await (await fetch(base + route)).text(), /Audit Live Before/);
    const response = await adminContext.request.post(`${base}/api/admin/settings/site`, { ...requestOptions, form: { name: "Audit Live After", commentsEnabled: "true", videosEnabled: "true", contentLanguageMode: "bilingual", settingsTab: "site" } });
    assert.equal(response.status(), 303);
    for (const route of paths) assert.match(await (await fetch(base + route)).text(), /Audit Live After/, route);
  });
  await check("英文页面 canonical 与浏览器语言替代地址正确", async () => {
    for (const route of ["/en/account", "/en/create", "/en/write", "/en/settings", "/en/stats"]) {
      await publicPage.goto(base + route, { waitUntil: "networkidle" });
      assert.equal(await publicPage.locator('link[rel="canonical"]').getAttribute("href"), base + route);
      assert.ok(await publicPage.locator('link[hreflang="zh-CN"]').count());
    }
  });

  const memberContext = await newContext();
  const memberLogin = await memberContext.request.post(`${base}/api/member/login`, { ...requestOptions, data: { account: "audit-member", secret: memberPassword } });
  assert.equal(memberLogin.status(), 200, await memberLogin.text());
  const genre = await database.creationGenre.findFirstOrThrow({ where: { threshold: 65 } });
  await check("模型不可用时真实评分 API 不签发正式评分，发布返回 409", async () => {
    const work = await database.creativeWork.create({ data: { ownerId: member.id, genreId: genre.id, mode: "MANUAL", depth: "FULL", status: "DRAFT", topic: "个人叙事", title: "故障评分验收", summary: "测试结构预检不得代替正式评分", content: ("真实素材与具体细节。".repeat(200) + "\n\n").repeat(5) } });
    const response = await memberContext.request.post(`${base}/api/public/creation/works/${work.id}/score`, { ...requestOptions, data: { expectedUpdatedAt: work.updatedAt.toISOString() } });
    assert.equal(response.status(), 200, await response.text());
    const scoreResponse = await response.json();
    assert.equal(scoreResponse.scoreFallback, true);
    assert.equal(scoreResponse.work.scoreDetail?.fallback, true, "owner response must retain non-official precheck details");
    assert.equal(scoreResponse.work.scoreDetail?.publishable, false);
    assert.equal(scoreResponse.work.scoreCurrent, false);
    const updated = await database.creativeWork.findUniqueOrThrow({ where: { id: work.id } });
    assert.equal(updated.score, null); assert.equal(updated.scoredHash, null); assert.equal(updated.scoredAt, null);
    const detail = JSON.parse(updated.scoreDetail);
    assert.equal(detail.fallback, true); assert.equal(detail.publishable, false); assert.ok(detail.total < 65);
    const publish = await memberContext.request.post(`${base}/api/public/creation/works/${work.id}/publish`, { ...requestOptions, data: { expectedUpdatedAt: updated.updatedAt.toISOString() } });
    assert.equal(publish.status(), 409, await publish.text());
  });
  await check("20 个并发访谈回答只推进一次、只消耗一次全局 AI 配额", async () => {
    const work = await database.creativeWork.create({ data: { ownerId: member.id, genreId: genre.id, mode: "VOICE_FIRST", depth: "FULL", topic: "我的工作经历", pendingQuestion: "请描述一次难忘的工作经历？" } });
    const previous = Number(await redis.get("shibei:rate:creation:global") || 0);
    const responses = await Promise.all(Array.from({ length: 20 }, () => memberContext.request.post(`${base}/api/public/creation/works/${work.id}/answer`, { ...requestOptions, data: { answer: "这是用于真实并发验收的个人经历，包含时间、行动和结果。", expectedUpdatedAt: work.updatedAt.toISOString() } })));
    assert.equal(responses.filter((response) => response.status() === 200).length, 1, JSON.stringify(responses.map((response) => response.status())));
    assert.ok(responses.every((response) => [200, 409].includes(response.status())));
    const updated = await database.creativeWork.findUniqueOrThrow({ where: { id: work.id } });
    assert.equal(JSON.parse(updated.interview).length, 1);
    assert.equal(Number(await redis.get("shibei:rate:creation:global")) - previous, 1);
  });
  await check("私有文档标题 201 字符被拒绝，200 字符可保存", async () => {
    const doc = await database.writingDoc.create({ data: { ownerId: member.id, title: "标题", content: "正文" } });
    const bad = await memberContext.request.patch(`${base}/api/public/writing/docs/${doc.id}`, { ...requestOptions, data: { title: "字".repeat(201), expectedUpdatedAt: doc.updatedAt.toISOString() } });
    assert.equal(bad.status(), 400, await bad.text());
    const ok = await memberContext.request.patch(`${base}/api/public/writing/docs/${doc.id}`, { ...requestOptions, data: { title: "字".repeat(200), expectedUpdatedAt: doc.updatedAt.toISOString() } });
    assert.equal(ok.status(), 200, await ok.text());
  });

  await check("1500 篇文章下删除视频不等待无关文章行锁，待审核引用仍受保护", async () => {
    await database.post.createMany({ data: Array.from({ length: 1500 }, (_, index) => ({ id: `audit-volume-${index}`, slug: `audit-volume-${index}`, title: `体量测试 ${index}`, summary: "独立数据库", content: "无关正文。".repeat(1000) })) });
    const video = await database.video.create({ data: { title: "删除并发测试", type: "LINK", url: "https://example.com/video", summary: "无本地文件" } });
    const token = `[[video:${video.id}]]`;
    const ref = await database.post.create({ data: { slug: "audit-video-reference", title: "引用", summary: "引用", content: `正文\n\n${token}`, contentEn: `English\n\n${token}`, pendingRevision: { content: token } } });
    const blocked = await adminContext.request.post(`${base}/api/admin/videos/delete?id=${video.id}`, requestOptions);
    assert.ok([303, 307].includes(blocked.status()));
    assert.ok(await database.video.findUnique({ where: { id: video.id } }));
    await database.post.update({ where: { id: ref.id }, data: { pendingRevision: Prisma.DbNull } });
    let release; let signal;
    const held = new Promise((resolve) => { signal = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const transaction = database.$transaction(async (tx) => { await tx.$queryRaw`SELECT "id" FROM "Post" WHERE "id" = 'audit-volume-0' FOR UPDATE`; signal(); await gate; }, { timeout: 12_000 });
    await held;
    try {
      const response = await adminContext.request.post(`${base}/api/admin/videos/delete?id=${video.id}`, { ...requestOptions, timeout: 4_000 });
      assert.ok([303, 307].includes(response.status()), await response.text());
      assert.equal(await database.video.findUnique({ where: { id: video.id } }), null);
      const updated = await database.post.findUniqueOrThrow({ where: { id: ref.id } });
      assert.ok(!updated.content.includes(token)); assert.ok(!updated.contentEn.includes(token));
    } finally { release(); await transaction; }
  });
  await check("连续 12 次正确登录不触发账号失败限额，超大表单返回 413", async () => {
    for (let i = 0; i < 12; i++) {
      const response = await adminContext.request.post(`${base}/api/admin/login`, { ...requestOptions, form: { username: env.ADMIN_USERNAME, password: adminPassword } });
      assert.equal(response.status(), 303); assert.equal(new URL(response.headers().location, base).pathname, "/admin");
    }
    const big = await fetch(`${base}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `password=${"a".repeat(17000)}` });
    assert.equal(big.status, 413);
  });
  await check("当前密码校验、改密吊销旧会话，重跑 seed + 实际重启不回退", async () => {
    const original = await database.adminUser.findFirstOrThrow();
    const nextPassword = `Changed!${crypto.randomBytes(12).toString("hex")}Z9`;
    const nextUsername = "audit-renamed";
    const wrong = await adminContext.request.post(`${base}/api/admin/settings/admin`, { ...requestOptions, form: { username: nextUsername, password: nextPassword, currentPassword: "wrong" } });
    assert.equal(new URL(wrong.headers().location, base).searchParams.get("accountError"), "current_password");
    assert.equal((await database.adminUser.findFirstOrThrow()).passwordHash, original.passwordHash);
    await adminPage.goto(`${base}/admin/settings?tab=account`, { waitUntil: "networkidle" });
    await adminPage.locator('input[name="username"]').fill(nextUsername);
    await adminPage.locator('input[name="currentPassword"]').fill(adminPassword);
    await adminPage.locator('input[name="password"]').fill(nextPassword);
    await Promise.all([adminPage.waitForURL((url) => url.pathname === "/admin/login"), adminPage.locator('#settings-panel-account button[type="submit"]').click()]);
    const changed = await database.adminUser.findFirstOrThrow();
    assert.equal(changed.username, nextUsername); assert.equal(changed.tokenVersion, original.tokenVersion + 1);
    const stale = await browser.newContext({ storageState: authSnapshot });
    const staleResponse = await stale.request.get(`${base}/api/admin/update/status`, { maxRedirects: 0 });
    assert.ok([401, 303, 307].includes(staleResponse.status())); await stale.close();
    await stop(web);
    await run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"], "seed-restart");
    assert.equal(await database.adminUser.count(), 1);
    const reseeded = await database.adminUser.findFirstOrThrow();
    assert.equal(reseeded.passwordHash, changed.passwordHash); assert.equal(reseeded.tokenVersion, changed.tokenVersion);
    await startWeb();
    const fresh = await newContext();
    const loggedIn = await adminLogin(fresh, nextUsername, nextPassword);
    await loggedIn.screenshot({ path: path.join(output, "admin-after-restart.png") });
    await fresh.close();
  });
  await check("真实浏览器全流程没有未处理的页面 JavaScript 错误", async () => assert.deepEqual(pageErrors, []));
} catch (error) {
  failed = true;
  console.error(error.stack || error);
  checks.push({ name: "run failure", passed: false, error: error.message });
  if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: path.join(output, "failure.png") }).catch(() => undefined);
} finally {
  await browser?.close().catch(() => undefined);
  await stop(web);
  if (updaterStub.listening) {
    updaterStub.closeAllConnections();
    await new Promise((resolve) => updaterStub.close(resolve));
  }
  await database?.$disconnect().catch(() => undefined);
  redis?.disconnect();
  await stop(redisProcess);
  if (pgStarted) await run(path.join(pgBin, "pg_ctl"), ["-D", path.join(temporary, "pg"), "-m", "fast", "-w", "stop"], "pg-stop").catch((error) => { failed = true; console.error(error.message); });
  for (const child of children) await stop(child);
  const configPath = path.join(root, "tsconfig.json");
  const config = await fs.readFile(configPath, "utf8");
  await fs.writeFile(configPath, config.replaceAll(`,\n    "${dist}/types/**/*.ts"`, "").replaceAll(`,\n    "${dist}/dev/types/**/*.ts"`, ""));
  const nextEnvPath = path.join(root, "next-env.d.ts");
  if ((await fs.readFile(nextEnvPath, "utf8")).includes(dist)) await fs.writeFile(nextEnvPath, beforeNextEnv);
  // These directories were created exclusively by this run, never reuse production paths.
  await fs.rm(path.join(root, dist), { recursive: true, force: true });
  await fs.rm(temporary, { recursive: true, force: true });
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ passed: !failed, checks, pageErrors, isolatedServicesStopped: true }, null, 2));
  console.log(`Result: ${checks.filter((check) => check.passed).length} checks passed; ${failed ? "FAILED" : "PASS"}. Artifacts: ${output}`);
}
if (failed) process.exitCode = 1;
