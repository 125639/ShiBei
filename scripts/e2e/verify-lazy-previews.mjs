/** Client-only preview regression using mocked writing documents. No real draft,
 * model call or credential is created/modified; use against a local built app.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = (process.env.BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const browser = await chromium.launch();
const contexts = [];
const errors = [];
let passed = 0;
const pass = (label) => {
  passed++;
  console.log(`PASS ${label}`);
};
const initial = {
  id: "runtime-preview-doc",
  title: "按需预览验收",
  content: "## 正文预览标题\n\n**保留这段正文。**\n\n[Unsafe](javascript:alert(1))",
  completedAt: null,
  creativeWorkId: null,
  publicationBlockedAt: null,
  updatedAt: "2026-01-01T00:00:00.000Z"
};
async function context() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  contexts.push(ctx);
  ctx.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  return ctx;
}
try {
  let doc = { ...initial };
  let revision = 1;
  const ctx = await context();
  await ctx.route("**/api/public/writing/docs**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "PATCH")
      doc = {
        ...doc,
        ...req.postDataJSON(),
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, revision++)).toISOString()
      };
    if (url.pathname.endsWith("/complete")) doc.completedAt = doc.updatedAt;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        url.pathname === "/api/public/writing/docs" && req.method() === "GET"
          ? { docs: [doc], nextCursor: null, hasMore: false }
          : { doc }
      )
    });
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/zh/write`);
  await page.locator('.tiptap[contenteditable="true"]').waitFor({ state: "visible" });
  assert.ok((await page.locator(".tiptap").innerText()).includes("保留这段正文"));
  const before = await page.evaluate(
    () => performance.getEntriesByType("resource").filter((entry) => entry.initiatorType === "script").length
  );
  await page.getByRole("button", { name: "完成并预览", exact: true }).click();
  await page.locator('[data-testid="writing-finish-preview"] .prose h2').waitFor({ state: "visible" });
  assert.equal(
    await page.locator('[data-testid="writing-finish-preview"] .prose h2').innerText(),
    "正文预览标题"
  );
  assert.equal(
    await page.locator('[data-testid="writing-finish-preview"] a[href^="javascript:"]').count(),
    0
  );
  const after = await page.evaluate(
    () => performance.getEntriesByType("resource").filter((entry) => entry.initiatorType === "script").length
  );
  assert.ok(after > before, "The separate preview renderer should load only when needed");
  pass("editor works without installed editor packages; completion loads the sanitized preview on demand");
  await page.getByRole("button", { name: "返回修改", exact: true }).click();
  await page.locator('.tiptap[contenteditable="true"]').waitFor();
  assert.ok((await page.locator(".tiptap").innerText()).includes("保留这段正文"));
  pass("returning from the preview preserves editor content");
  doc = { ...doc, creativeWorkId: "mock-publication-id" };
  await page.reload();
  await page.locator('[data-testid="writing-submitted-state"] .prose h2').waitFor();
  assert.equal(
    await page.locator('[data-testid="writing-submitted-state"] .prose h2').innerText(),
    "正文预览标题"
  );
  assert.equal(await page.locator('.tiptap[contenteditable="true"]').count(), 0);
  pass("handed-off documents render their read-only preview without being stuck loading");
  const cursorCtx = await context();
  await cursorCtx.addInitScript(() => {
    try {
      localStorage.setItem("shibei.customCursor", "true");
    } catch {
      /* initial about:blank */
    }
  });
  const cursorPage = await cursorCtx.newPage();
  await cursorPage.goto(`${base}/zh`);
  await cursorPage.waitForFunction(() => document.documentElement.dataset.cursor === "custom");
  await cursorPage.emulateMedia({ reducedMotion: "reduce" });
  await cursorPage.waitForFunction(() => !document.documentElement.hasAttribute("data-cursor"));
  pass("on-demand cursor still honors opt-in and reduced motion");
  assert.deepEqual(errors, []);
  console.log(`${passed} lazy-loading checks passed.`);
} finally {
  await Promise.all(contexts.map((ctx) => ctx.close()));
  await browser.close();
}
