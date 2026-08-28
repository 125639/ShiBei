/** Disposable-stack E2E for administrator username/password changes and session revocation. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";

try { if (typeof process.loadEnvFile === "function") process.loadEnvFile(".env"); } catch {}
if (process.env.ALLOW_LIVE_WRITE !== "1") throw new Error("Set ALLOW_LIVE_WRITE=1 only for a disposable stack");
if (!process.env.ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD is required");

const { chromium } = createRequire(import.meta.url)("playwright");
const prisma = new PrismaClient();
const base = (process.env.BASE_URL || "http://127.0.0.1:3200").replace(/\/$/, "");
const oldUsername = process.env.ADMIN_USERNAME || "admin";
const oldPassword = process.env.ADMIN_PASSWORD;
const newUsername = `auditadmin${Date.now()}`;
const newPassword = `Fresh!Audit${Date.now()}z9`;
const original = await prisma.adminUser.findUnique({ where: { username: oldUsername } });
assert.ok(original);
const browser = await chromium.launch({ headless: true });

async function login(context, username, password) {
  const page = await context.newPage();
  await page.goto(`${base}/admin/login`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin", { timeout: 120_000 }),
    page.click('button[type="submit"]')
  ]);
  return page;
}

async function change(page, username, password) {
  return page.evaluate(async ({ username, password }) => {
    const form = new FormData();
    form.set("username", username);
    form.set("password", password);
    const response = await fetch("/api/admin/settings/admin", { method: "POST", body: form, redirect: "follow" });
    return { status: response.status, url: response.url, text: await response.text() };
  }, { username, password });
}

let changed = false;
try {
  const context = await browser.newContext();
  const page = await login(context, oldUsername, oldPassword);

  const weak = await change(page, oldUsername, "password");
  assert.equal(weak.status, 200);
  assert.equal(new URL(weak.url).searchParams.get("accountError"), "weak_password");
  assert.equal((await prisma.adminUser.findUnique({ where: { id: original.id } }))?.tokenVersion, original.tokenVersion);
  console.log("PASS  弱管理员密码被拒绝且不会修改账号");

  const invalidName = await change(page, "a", "");
  assert.equal(invalidName.status, 200);
  assert.equal(new URL(invalidName.url).searchParams.get("accountError"), "invalid_username");
  console.log("PASS  非法管理员用户名被拒绝");

  const changedResponse = await change(page, newUsername, newPassword);
  assert.equal(changedResponse.status, 200, changedResponse.text);
  assert.equal(new URL(changedResponse.url).pathname, "/admin/login");
  assert.equal(new URL(changedResponse.url).searchParams.get("accountChanged"), "1");
  changed = true;
  const updated = await prisma.adminUser.findUnique({ where: { id: original.id } });
  assert.equal(updated?.username, newUsername);
  assert.equal(updated?.tokenVersion, original.tokenVersion + 1);

  const oldApiSession = await context.request.get(`${base}/api/admin/update/status?authCheck=${Date.now()}`, {
    maxRedirects: 0, timeout: 30_000, headers: { "Cache-Control": "no-store" }
  });
  await assertUnauthorized(oldApiSession);
  const oldSession = await context.request.get(`${base}/admin?authCheck=${Date.now()}`, {
    maxRedirects: 0, timeout: 30_000, headers: { "Cache-Control": "no-store" }
  });
  await assertUnauthorized(oldSession);
  console.log("PASS  改密后旧管理员会话立即失效");
  await context.close();

  const newContext = await browser.newContext();
  await login(newContext, newUsername, newPassword);
  const authorized = await newContext.request.get(`${base}/admin`, { maxRedirects: 0, timeout: 30_000 });
  assert.equal(authorized.status(), 200);
  console.log("PASS  新用户名和强密码可重新登录后台");
  await newContext.close();
} finally {
  if (changed) {
    await prisma.adminUser.update({
      where: { id: original.id },
      data: {
        username: original.username,
        passwordHash: original.passwordHash,
        tokenVersion: original.tokenVersion,
        updatedAt: original.updatedAt
      }
    }).catch(() => undefined);
  }
  await prisma.$disconnect();
  await browser.close().catch(() => undefined);
}

async function assertUnauthorized(response) {
  const redirectedToLogin = new URL(response.url()).pathname === "/admin/login";
  const rejected = [302, 303, 307, 308, 401, 403].includes(response.status());
  if (!rejected && !redirectedToLogin && response.status() === 200) {
    // Next's development server may flush the HTML shell before a Server
    // Component redirect is thrown. In that case the wire status is 200 but
    // the flight payload must contain only the login redirect, never dashboard
    // data. Production emits the normal 307 response.
    const body = await response.text();
    assert.match(body, /NEXT_REDIRECT/);
    assert.match(body, /\/admin\/login/);
    assert.doesNotMatch(body, /待审核草稿|运行中任务|Admin Dashboard/);
    return;
  }
  assert.ok(rejected || redirectedToLogin, `${response.status()} ${response.url()}`);
  if ([302, 303, 307, 308].includes(response.status())) {
    assert.match(response.headers().location || "", /\/admin\/login/);
  }
}
