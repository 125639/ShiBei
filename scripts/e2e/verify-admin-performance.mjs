/** Read-only admin performance/interaction audit. No content/model/credential writes.
 * Mints an in-memory short-lived session using the local AUTH_SECRET; never prints it.
 * BASE_URL must point to this deployment's origin or a loopback preview.
 * BASE_URL=http://127.0.0.1:3100 npm run test:admin-ui
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
nextEnv.loadEnvConfig(root, false);
const base = (process.env.BASE_URL || process.env.PUBLIC_URL).replace(/\/$/, "");
const target = new URL(base);
const origin = new URL(process.env.PUBLIC_URL);
if (![origin.hostname, "127.0.0.1", "localhost", "[::1]"].includes(target.hostname))
  throw new Error("Refusing to send a local admin session to another host");
const artifacts = process.env.ADMIN_UI_ARTIFACTS_DIR || "/tmp/shibei-admin-ui";
await mkdir(artifacts, { recursive: true, mode: 0o700 });
const db = new PrismaClient();
const [admin, post] = await Promise.all([
  db.adminUser.findFirst({ select: { id: true, tokenVersion: true } }),
  db.post.findFirst({ select: { id: true } })
]);
await db.$disconnect();
if (!admin) throw new Error("No admin account available");
const sign = (version) =>
  new SignJWT({ userId: admin.id, ver: version })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("20m")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
const cookie = (token) => ({
  name: target.protocol === "https:" ? "__Host-shibei_admin_session" : "shibei_http_admin_session",
  value: token,
  url: base,
  httpOnly: true,
  secure: target.protocol === "https:",
  sameSite: "Lax"
});
const browser = await chromium.launch({ headless: true });
const contexts = [];
const runtimeErrors = [];
const result = { pages: [], navigation: [], checks: 0 };
function pass(label) {
  result.checks++;
  console.log(`PASS ${label}`);
}
async function context(auth = true, options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
  contexts.push(ctx);
  if (auth) await ctx.addCookies([cookie(await sign(admin.tokenVersion))]);
  ctx.on("page", (page) => page.on("pageerror", (error) => runtimeErrors.push(error.message)));
  return ctx;
}
async function ready(page, heading) {
  await page.locator(".admin-main h1").waitFor({ state: "visible" });
  if (heading)
    await page.waitForFunction(
      (text) => document.querySelector(".admin-main h1")?.textContent.includes(text),
      heading
    );
}
async function dismissUpdate(page) {
  const close = page.locator(".update-toast-close");
  if (await close.isVisible()) await close.click();
}

try {
  const anonymous = await context(false);
  const visitor = await anonymous.newPage();
  await visitor.goto(`${base}/admin/posts`);
  await visitor.waitForURL(`${base}/admin/login`);
  assert.equal(await visitor.locator(".admin-sidebar").count(), 0);
  const forbidden = await anonymous.request.get(`${base}/api/admin/storage/usage`);
  assert.equal(forbidden.status(), 401);
  pass("anonymous visitors cannot read the workspace or storage report");

  const ctx = await context();
  const page = await ctx.newPage();
  const routes = [
    "/admin",
    "/admin/posts",
    "/admin/jobs",
    "/admin/settings",
    "/admin/sources",
    "/admin/stats",
    ...(post ? [`/admin/posts/${post.id}`] : [])
  ];
  for (const route of routes) {
    const sizes = [];
    const track = async (response) => {
      if (response.request().resourceType() === "script")
        sizes.push((await response.body().catch(() => Buffer.alloc(0))).length);
    };
    page.on("response", track);
    const response = await page.goto(base + route, { waitUntil: "load" });
    await ready(page);
    await page.waitForTimeout(400);
    const metrics = await page.evaluate(() => {
      const entry = performance.getEntriesByType("navigation")[0];
      return {
        ttfb: Math.round(entry.responseStart - entry.requestStart),
        load: Math.round(entry.loadEventEnd - entry.startTime),
        htmlBytes: entry.decodedBodySize
      };
    });
    page.off("response", track);
    assert.equal(response.status(), 200, route);
    const record = { route, ...metrics, jsBytes: sizes.reduce((a, b) => a + b, 0), scripts: sizes.length };
    result.pages.push(record);
    console.log("PAGE", JSON.stringify(record));
  }
  pass("all main admin pages and the post editor render successfully");

  await page.goto(base + "/admin");
  await ready(page, "管理后台");
  await page.evaluate(() => {
    window.__adminSidebar = document.querySelector(".admin-sidebar-desktop");
  });
  for (const [route, heading] of [
    ["/admin/posts", "草稿与文章"],
    ["/admin/settings", "系统设置"],
    ["/admin/jobs", "任务诊断"],
    ["/admin", "管理后台"]
  ]) {
    await dismissUpdate(page);
    const rsc = [];
    const track = (request) => {
      if (request.url().includes("_rsc=")) rsc.push(new URL(request.url()).pathname);
    };
    page.on("request", track);
    const started = performance.now();
    await page.locator(`.admin-sidebar-desktop a[href="${route}"]`).click();
    await page.waitForURL(base + route);
    await ready(page, heading);
    const elapsed = Math.round(performance.now() - started);
    await page.waitForTimeout(250);
    page.off("request", track);
    assert.ok(
      await page.evaluate(() => window.__adminSidebar === document.querySelector(".admin-sidebar-desktop")),
      "sidebar must persist"
    );
    assert.ok(rsc.length <= 4, `Unbounded prefetch fan-out: ${rsc.join(", ")}`);
    result.navigation.push({ route, ms: elapsed, rscRequests: rsc.length, sidebarPreserved: true });
    console.log("NAV", JSON.stringify(result.navigation.at(-1)));
  }
  pass("navigation preserves the sidebar and no longer fans out to all admin routes");

  await page.goto(base + "/admin/posts");
  await ready(page);
  await page.evaluate(() => {
    window.__adminDocument = document;
    window.__adminSidebar = document.querySelector(".admin-sidebar-desktop");
  });
  await page.locator("#admin-post-search").fill("no-match-admin-performance-audit");
  await page.locator("#admin-post-search").press("Enter");
  await page.waitForURL((url) => url.searchParams.get("q") === "no-match-admin-performance-audit");
  await ready(page);
  assert.ok(
    await page.evaluate(
      () =>
        window.__adminDocument === document &&
        window.__adminSidebar === document.querySelector(".admin-sidebar-desktop")
    )
  );
  assert.match(await page.locator(".admin-main").innerText(), /没有找到/);
  pass("search uses client navigation rather than a full-page reload");

  // A fresh context makes lazy-loading observable instead of reusing an editor chunk.
  const editorCtx = await context();
  const editor = await editorCtx.newPage();
  await editor.goto(base + "/admin/posts");
  await ready(editor);
  const scriptsBefore = await editor.evaluate(
    () => performance.getEntriesByType("resource").filter((entry) => entry.initiatorType === "script").length
  );
  const create = editor
    .locator("details")
    .filter({ has: editor.locator("#content") })
    .first();
  await create.locator("summary").first().click();
  await editor.locator("#content").fill("## Preview audit\n\n**Lazy parsing works**");
  await editor.locator(".admin-markdown-preview strong").filter({ hasText: "Lazy parsing works" }).waitFor();
  const scriptsAfter = await editor.evaluate(
    () => performance.getEntriesByType("resource").filter((entry) => entry.initiatorType === "script").length
  );
  assert.ok(scriptsAfter > scriptsBefore, "Markdown parser should load on demand");
  await editor.getByRole("button", { name: "专注写作", exact: false }).click();
  await editor.waitForFunction(() => document.body.classList.contains("admin-editor-focus-open"));
  await editor.keyboard.press("Escape");
  await editor.waitForFunction(() => !document.body.classList.contains("admin-editor-focus-open"));
  pass("hidden editor defers parser loading; preview and focus mode still work without saving");

  const settingsCtx = await context();
  const settings = await settingsCtx.newPage();
  const storageRequests = [];
  settings.on("request", (request) => {
    if (request.url().includes("/api/admin/storage/usage")) storageRequests.push(request);
  });
  await settings.goto(base + "/admin/settings");
  await ready(settings);
  await settings.waitForTimeout(500);
  assert.equal(storageRequests.length, 0);
  await settingsCtx.route(
    "**/api/admin/storage/usage",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"controlled test failure"}'
      }),
    { times: 1 }
  );
  await settings.locator("#settings-tab-storage").click();
  await settings.locator(".admin-storage-state[role=alert]").waitFor();
  await settings.locator(".admin-storage-state").getByRole("button", { name: "重试" }).click();
  await settings.getByRole("button", { name: "刷新用量", exact: true }).waitFor();
  assert.equal(storageRequests.length, 2);
  await settings.locator("#settings-tab-site").click();
  await settings.waitForTimeout(350);
  assert.equal(storageRequests.length, 2);
  const report = await settingsCtx.request.get(base + "/api/admin/storage/usage");
  assert.match(report.headers()["cache-control"], /no-store/);
  pass("storage loads only on its tab, retries failures and is never publicly cached");

  await page.goto(base + "/admin/jobs");
  await ready(page);
  assert.ok((await page.locator(".job-row").count()) <= 40);
  const nextPage = page.locator('.pagination-row a[rel="next"]');
  if (await nextPage.count()) {
    await nextPage.click();
    await page.waitForURL((url) => url.searchParams.get("page") === "2");
    await ready(page);
    assert.ok((await page.locator(".job-row").count()) <= 40);
  }
  pass("job lists are bounded and paginated");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".admin-mobile-menu summary").click();
  await page.locator('.admin-mobile-nav a[href="/admin/settings"]').click();
  await page.waitForURL(base + "/admin/settings");
  await ready(page);
  assert.equal(await page.locator(".admin-mobile-menu").getAttribute("open"), null);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(artifacts, "admin-mobile.png") });
  pass("mobile navigation remains usable with the persistent workspace");

  // A correctly signed but stale version must not inherit a previous request's auth.
  const revoked = await context(false);
  await revoked.addCookies([cookie(await sign(admin.tokenVersion - 1))]);
  assert.equal((await revoked.request.get(base + "/api/admin/storage/usage")).status(), 401);
  const expiredPage = await revoked.newPage();
  await expiredPage.goto(base + "/admin/jobs");
  await expiredPage.waitForURL(base + "/admin/login");
  assert.equal(await expiredPage.locator(".admin-sidebar").count(), 0);
  pass("revoked sessions still fail closed across separate page and API requests");
  assert.deepEqual(runtimeErrors, []);
  pass("no runtime or hydration errors");
  await writeFile(path.join(artifacts, "results.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(`${result.checks} admin checks passed. Metrics: ${artifacts}/results.json`);
} finally {
  await Promise.all(contexts.map((ctx) => ctx.close()));
  await browser.close();
}
