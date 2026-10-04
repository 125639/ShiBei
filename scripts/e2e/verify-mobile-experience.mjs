/** Phone-sized public/admin audit. No content edits are saved or AI requests made.
 * It creates only an in-memory 20-minute admin session. BASE_URL must be the
 * configured host or a loopback preview; no credentials are printed or saved.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
nextEnv.loadEnvConfig(root, false);
const base = (process.env.BASE_URL || process.env.PUBLIC_URL).replace(/\/$/, "");
const target = new URL(base);
if (![new URL(process.env.PUBLIC_URL).hostname, "127.0.0.1", "localhost", "[::1]"].includes(target.hostname))
  throw new Error("Unsafe audit target");
const dir = process.env.MOBILE_UI_ARTIFACTS_DIR || "/tmp/shibei-mobile-ui";
await mkdir(dir, { recursive: true, mode: 0o700 });
const db = new PrismaClient();
const [admin, post] = await Promise.all([
  db.adminUser.findFirst({ select: { id: true, tokenVersion: true } }),
  db.post.findFirst({
    where: { status: "PUBLISHED", publicationBlockedReason: null },
    select: { id: true, slug: true }
  })
]);
await db.$disconnect();
if (!admin) throw new Error("An existing administrator is required for read-only admin checks");
const jwt = await new SignJWT({ userId: admin.id, ver: admin.tokenVersion })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("20m")
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
const browser = await chromium.launch();
const contexts = [];
const errors = [];
let checks = 0;
const pass = (label) => {
  checks++;
  console.log(`PASS ${label}`);
};
async function context(options = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    ...options
  });
  contexts.push(ctx);
  await ctx.addCookies([
    {
      name: target.protocol === "https:" ? "__Host-shibei_admin_session" : "shibei_http_admin_session",
      value: jwt,
      url: base,
      secure: target.protocol === "https:",
      httpOnly: true,
      sameSite: "Lax"
    }
  ]);
  ctx.on("page", (page) =>
    page.on("pageerror", (error) => errors.push({ url: page.url(), error: error.message }))
  );
  return ctx;
}
async function fits(page, label) {
  const width = page.viewportSize().width;
  // On mobile Chromium can enlarge the layout viewport for an overflowing child.
  // Comparing scrollWidth to innerWidth alone silently misses that failure.
  const actual = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: innerWidth
  }));
  assert.ok(
    actual.scroll <= width + 1 && actual.viewport <= width + 1,
    `${label}: ${JSON.stringify(actual)} > ${width}px`
  );
}
async function contained(locator, page, height = page.viewportSize().height, top = 0) {
  const bounds = await locator.boundingBox();
  assert.ok(bounds, "element must be visible");
  assert.ok(
    bounds.x >= -1 && bounds.x + bounds.width <= page.viewportSize().width + 1,
    `horizontal clipping: ${JSON.stringify(bounds)}`
  );
  assert.ok(
    bounds.y >= top - 1 && bounds.y + bounds.height <= top + height + 1,
    `vertical clipping: ${JSON.stringify(bounds)}, visible ${top}..${top + height}`
  );
}
async function ready(page, admin = false) {
  await page
    .locator(admin ? ".admin-main h1" : "main h1")
    .first()
    .waitFor({ state: "visible" });
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue("--visible-viewport-height") !== ""
  );
}
async function shot(page, name, fullPage = false) {
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage, animations: "disabled" });
}
async function keyboardViewport(page, height, top = 0, scale = 1) {
  await page.evaluate(
    ({ height, top, scale }) => {
      const vv = window.visualViewport;
      Object.defineProperty(vv, "height", { configurable: true, value: height });
      Object.defineProperty(vv, "offsetTop", { configurable: true, value: top });
      Object.defineProperty(vv, "scale", { configurable: true, value: scale });
      vv.dispatchEvent(new Event("resize"));
    },
    { height, top, scale }
  );
  await page.waitForTimeout(80);
}
async function resetViewport(page) {
  await page.evaluate(() => {
    delete window.visualViewport.height;
    delete window.visualViewport.offsetTop;
    delete window.visualViewport.scale;
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(80);
}

try {
  const ctx = await context();
  const page = await ctx.newPage();
  const routes = [
    "/zh",
    "/en",
    "/zh/posts",
    "/zh/stats",
    "/zh/create",
    "/admin/posts",
    "/admin/settings",
    "/admin/stats",
    ...(post ? [`/admin/posts/${post.id}`] : [])
  ];
  for (const route of routes) {
    const response = await page.goto(base + route, { waitUntil: "load" });
    assert.equal(response.status(), 200, route);
    await ready(page, route.startsWith("/admin"));
    for (const [width, height] of [
      [320, 740],
      [360, 800],
      [390, 844],
      [430, 932],
      [844, 390]
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(60);
      await fits(page, `${route} at ${width}px`);
    }
  }
  pass("320–430px phones and landscape: no cropped page or enlarged mobile layout viewport");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/zh");
  await ready(page);
  for (const selector of [
    ".publication-search-trigger",
    ".publication-menu-trigger",
    ".theme-switcher-trigger"
  ]) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, `${selector} is too small to tap`);
  }
  await page.evaluate(() => window.scrollTo({ top: 420, behavior: "instant" }));
  await page.getByRole("button", { name: "外观设置", exact: true }).tap();
  const appearance = page.locator(".appearance-dialog");
  await appearance.waitFor({ state: "visible" });
  assert.ok(await appearance.evaluate((el) => el.matches(":modal")));
  await contained(appearance, page);
  await contained(page.getByRole("button", { name: "关闭外观设置", exact: true }), page);
  await appearance.getByRole("button", { name: "简约", exact: true }).tap();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "minimal");
  await appearance.getByRole("button", { name: "Apple", exact: false }).tap();
  await appearance.locator(".quick-style-footer").scrollIntoViewIfNeeded();
  await contained(page.getByRole("button", { name: "关闭外观设置", exact: true }), page);
  await shot(page, "appearance-mobile");
  await page.keyboard.press("Escape");
  await appearance.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.documentElement.style.overflow !== "hidden");
  assert.ok(await page.locator(".theme-switcher-trigger").evaluate((el) => el === document.activeElement));
  pass(
    "appearance is a usable top-layer sheet: scrolling, themes, persistent close button and focus restoration"
  );

  await page.locator(".publication-menu-trigger").tap();
  await page.locator(".publication-dialog[open]").waitFor({ state: "visible" });
  await contained(page.locator(".publication-dialog"), page);
  await page.keyboard.press("Escape");
  await page.locator(".publication-search-trigger").tap();
  const search = page.locator(".publication-dialog input[name=q]");
  await search.focus();
  await keyboardViewport(page, 340, 18);
  await contained(page.locator(".publication-dialog"), page, 340, 18);
  await contained(search, page, 340, 18);
  await page.keyboard.press("Escape");
  await resetViewport(page);
  pass("menu and search stay inside the viewport, including a simulated on-screen keyboard");

  const assistantCalls = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/public/assistant") && req.method() === "POST") assistantCalls.push(req);
  });
  await page.locator(".ai-assistant-launcher").tap();
  const assistant = page.locator("#ai-assistant-panel");
  await assistant.waitFor({ state: "visible" });
  assert.ok(await assistant.evaluate((el) => el.matches(":modal")));
  const input = assistant.getByRole("textbox", { name: "AI 助手输入" });
  assert.equal(
    await input.evaluate((el) => el === document.activeElement),
    false,
    "Opening on a phone should not force the keyboard"
  );
  await input.fill("你好");
  await input.press("End");
  await input.press("Enter");
  assert.match(await input.inputValue(), /你好\n/);
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
    keyCode: 229,
    bubbles: true
  });
  assert.equal(assistantCalls.length, 0, "Return/IME must not send a paid AI request");
  await keyboardViewport(page, 360, 14);
  await contained(assistant, page, 360, 14);
  await contained(input, page, 360, 14);
  await contained(assistant.getByRole("button", { name: "发送", exact: true }), page, 360, 14);
  await shot(page, "assistant-keyboard");
  for (let i = 0; i < 10; i++) await page.keyboard.press("Tab");
  assert.ok(await assistant.evaluate((el) => el.contains(document.activeElement)));
  await assistant.getByRole("button", { name: "关闭助手", exact: true }).tap();
  await page.waitForFunction(() => document.documentElement.style.overflow !== "hidden");
  await resetViewport(page);
  pass(
    "assistant uses a modal sheet, keeps the send action above the keyboard and respects mobile Return / Chinese IME"
  );

  for (const route of ["/zh/stats", "/admin/stats"]) {
    await page.goto(base + route);
    await ready(page, route.startsWith("/admin"));
    for (const width of [320, 390, 844]) {
      await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".chart-frame > svg")].every(
          (svg) => Math.abs(svg.viewBox.baseVal.width - svg.getBoundingClientRect().width) < 2
        )
      );
      for (const svg of await page.locator(".chart-frame > svg").all()) {
        const bounds = await svg.boundingBox();
        assert.ok(bounds.width <= width - 24, "chart must reflow, not be clipped at 500px");
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const details = page.locator(".chart-data").first();
    if (await details.count()) {
      await details.locator("summary").tap();
      assert.ok((await details.locator("tbody tr").count()) >= 1);
      await details.locator("summary").tap();
    }
    await shot(page, route.startsWith("/admin") ? "admin-charts" : "public-charts", true);
  }
  pass("charts replot to container width, retain legible labels and expose data without hovering");

  if (post) {
    const editCtx = await context();
    const editor = await editCtx.newPage();
    await editor.goto(`${base}/admin/posts/${post.id}`);
    await ready(editor, true);
    await editor.setViewportSize({ width: 320, height: 740 });
    const scope = editor.locator(".post-assist-scope select");
    await scope.scrollIntoViewIfNeeded();
    await fits(editor, "post AI scope at 320px");
    const size = await scope.evaluate((el) => ({
      font: parseFloat(getComputedStyle(el).fontSize),
      height: el.getBoundingClientRect().height
    }));
    assert.ok(size.font >= 16 && size.height >= 44, "Scope selector should not trigger iOS focus zoom");
    await scope.selectOption("full");
    await editor.locator(".admin-editor-focus-button").first().tap();
    const focus = editor.locator(".admin-markdown-workspace.focus-mode");
    await focus.waitFor({ state: "visible" });
    const text = focus.locator("textarea").first();
    const original = await text.inputValue();
    await text.focus();
    await keyboardViewport(editor, 380, 12);
    await contained(focus, editor, 380, 12);
    await contained(focus.getByRole("button", { name: "退出专注", exact: true }), editor, 380, 12);
    const box = await text.boundingBox();
    assert.ok(
      box.height >= 90 && box.y + box.height <= 393,
      `Editor hidden behind keyboard: ${JSON.stringify(box)}`
    );
    await shot(editor, "admin-editor-keyboard");
    await focus.getByRole("button", { name: "退出专注", exact: true }).tap();
    assert.equal(await editor.locator("#content").inputValue(), original);
    await resetViewport(editor);
    pass("post AI selector and focused editor fit narrow phones and the keyboard without losing text");

    const readingCtx = await context();
    await readingCtx.addInitScript(() => {
      try {
        localStorage.setItem("shibei.music.enabled", "true");
        localStorage.setItem("shibei.music.volume", "0");
      } catch {
        /* about:blank has no storage origin */
      }
    });
    await readingCtx.route("**/api/public/music", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          tracks: [
            {
              id: "mobile-audit-track",
              title: "本地测试音轨",
              artist: "",
              filePath: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA="
            }
          ]
        })
      })
    );
    const reader = await readingCtx.newPage();
    await reader.goto(`${base}/zh/posts/${post.slug}`);
    await ready(reader);
    await reader.locator(".music-player[data-collapsed]").waitFor({ state: "visible" });
    await reader
      .locator("[data-reading-content]")
      .evaluate((el) =>
        window.scrollTo({
          top: scrollY + el.getBoundingClientRect().top + Math.min(500, el.clientHeight / 3),
          behavior: "instant"
        })
      );
    await reader.locator(".publication-reading-dock:not([hidden])").waitFor({ state: "visible" });
    for (const width of [320, 390]) {
      await reader.setViewportSize({ width, height: 844 });
      const boxes = await Promise.all(
        [".music-player", ".publication-reading-dock", ".ai-assistant-launcher"].map((selector) =>
          reader.locator(selector).boundingBox()
        )
      );
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i],
            b = boxes[j];
          const overlap =
            Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0 &&
            Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0;
          assert.equal(overlap, false, `Floating controls overlap: ${JSON.stringify(boxes)}`);
        }
    }
    await reader.getByRole("button", { name: "展开播放器", exact: true }).tap();
    await fits(reader, "expanded music controls");
    const player = await reader.locator(".music-player").boundingBox();
    const progress = await reader.locator(".publication-reading-dock").boundingBox();
    assert.ok(
      player.y + player.height <= progress.y || player.y >= progress.y + progress.height,
      "Expanded player covers reading progress"
    );
    assert.equal(
      await reader.locator(".article-toc-mobile").evaluate((el) => getComputedStyle(el).position),
      "static"
    );
    await shot(reader, "reading-controls");
    pass("music starts compact; music, article progress and AI touch controls no longer overlap");
  }

  const desktopCtx = await context({
    viewport: { width: 1440, height: 1000 },
    isMobile: false,
    hasTouch: false
  });
  const desktop = await desktopCtx.newPage();
  await desktop.goto(base + "/zh");
  await ready(desktop);
  await desktop.getByRole("button", { name: "外观设置", exact: true }).click();
  await desktop.locator(".appearance-dialog").waitFor({ state: "visible" });
  await contained(desktop.locator(".appearance-dialog"), desktop);
  await desktop.keyboard.press("Escape");
  await desktop.locator(".ai-assistant-launcher").click();
  await desktop.locator("#ai-assistant-panel").waitFor({ state: "visible" });
  assert.equal(await desktop.locator("#ai-assistant-panel").evaluate((el) => el.matches(":modal")), false);
  await contained(desktop.locator("#ai-assistant-panel"), desktop);
  await desktop.keyboard.press("Escape");
  assert.equal(await desktop.locator("#ai-assistant-panel").isVisible(), false);
  pass("desktop appearance remains usable and the assistant still allows reading alongside it");

  assert.deepEqual(errors, [], `Runtime/hydration failures: ${JSON.stringify(errors)}`);
  pass("no mobile or desktop runtime/hydration errors");
  await writeFile(path.join(dir, "results.json"), JSON.stringify({ checks, errors }, null, 2), {
    mode: 0o600
  });
  console.log(`${checks} mobile checks passed. Screenshots: ${dir}`);
} finally {
  await Promise.all(contexts.map((ctx) => ctx.close()));
  await browser.close();
}
