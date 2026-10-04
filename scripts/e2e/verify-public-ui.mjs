/**
 * Public browser checks: no fixture/content mutations, credentials or AI calls.
 * Normal page visits may record analytics through the existing visit beacon.
 * Run against a disposable/preview stack:
 *   BASE_URL=http://127.0.0.1:3100 npm run test:ui
 * Screenshots are written to UI_ARTIFACTS_DIR (default /tmp/shibei-public-ui).
 * A populated site exercises cards/reading; an empty site exercises its real empty state.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const base = (process.env.BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const artifacts = process.env.UI_ARTIFACTS_DIR || "/tmp/shibei-public-ui";
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const contexts = [];
let checks = 0;
const pass = (label) => {
  checks++;
  console.log(`PASS ${label}`);
};

async function context(options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
  contexts.push(ctx);
  ctx.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  return ctx;
}
async function screenshot(page, name, fullPage = false) {
  await page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage, animations: "disabled" });
}
async function assertFits(page, label) {
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: innerWidth
  }));
  assert.ok(sizes.scroll <= sizes.width + 1, `${label}: horizontal overflow ${JSON.stringify(sizes)}`);
}
async function ready(page, selector) {
  await page.locator(selector).first().waitFor({ state: "visible" });
  await page.waitForFunction(() => document.documentElement.dataset.siteMotion !== undefined);
}

try {
  const desktop = await context();
  const page = await desktop.newPage();
  const response = await page.goto(`${base}/zh`);
  assert.equal(response.status(), 200);
  await ready(page, ".publication-hero h1");
  assert.equal(await page.locator("h1").count(), 1);
  const allCards = await page.locator(".story-card").count();
  await screenshot(page, "home-desktop", true);
  if (allCards === 0) {
    assert.ok(await page.locator(".publication-empty").isVisible());
    assert.equal(
      await page
        .locator(".publication-hero-bottom")
        .innerText()
        .then((text) => /0 篇/.test(text)),
      false
    );
  }
  pass("home renders real content (or its empty state) and one accessible page heading");

  // The sculpture is interactive, not an automatic text carousel.
  await page.getByRole("button", { name: "思考", exact: true }).click();
  assert.equal(await page.locator(".hero-scene").getAttribute("data-mode"), "1");
  assert.match(await page.locator(".scene-note").innerText(), /多一个视角/);
  await page.getByRole("button", { name: "暂停动效", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("data-site-motion"), "paused");
  await page.reload();
  await ready(page, ".publication-hero h1");
  assert.equal(await page.locator("html").getAttribute("data-site-motion"), "paused");
  assert.equal(
    await page.locator(".publication-hero-copy").evaluate((el) => getComputedStyle(el).opacity),
    "1"
  );
  await page.getByRole("button", { name: "启用动效（遵循系统偏好）", exact: true }).click();
  pass("hero interaction, pause preference persistence and visible paused content");

  if ((await page.locator(".shelf-filters button").count()) > 1) {
    await page.locator(".shelf-filters button").nth(1).click();
    const filtered = await page.locator(".story-card").count();
    assert.ok(filtered > 0 && filtered <= allCards);
    assert.equal(await page.locator(".shelf-filters button").nth(1).getAttribute("aria-pressed"), "true");
    await page.locator(".shelf-filters button").first().click();
    assert.equal(await page.locator(".story-card").count(), allCards);
    pass("instant homepage topic filtering uses the published collection");
  }

  // Focus is trapped by the native modal, and Escape restores its trigger.
  const searchTrigger = page.locator(".publication-search-trigger");
  await searchTrigger.focus();
  await page.keyboard.press("Control+k");
  await page.locator("dialog[open] input[name=q]").waitFor({ state: "visible" });
  assert.ok(await page.locator("dialog input[name=q]").evaluate((el) => el === document.activeElement));
  for (let i = 0; i < 14; i++) await page.keyboard.press("Tab");
  assert.ok(await page.locator(".publication-dialog").evaluate((el) => el.contains(document.activeElement)));
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("dialog[open]").count(), 0);
  assert.ok(await searchTrigger.evaluate((el) => el === document.activeElement));
  await page.waitForFunction(() => document.documentElement.style.overflow !== "hidden");
  pass("keyboard shortcut, native focus trap, Escape and restored focus");

  await searchTrigger.click();
  await page.locator("dialog input[name=q]").fill("no-match-shibei-ui-93841");
  await page.locator("dialog input[name=q]").press("Enter");
  await page.waitForURL((url) => url.pathname === "/zh/posts" && url.searchParams.has("q"));
  await ready(page, ".publication-empty");
  assert.match(await page.locator(".publication-empty").innerText(), /没有找到/);
  assert.equal(await page.locator("dialog[open]").count(), 0);
  pass("search routes without a full reload and provides a useful empty state");

  await page.keyboard.press("Control+k");
  await page.locator("dialog[open]").waitFor();
  await page.locator(".publication-dialog-footer").getByRole("button", { name: "English" }).click();
  await page.waitForURL(
    (url) => url.pathname === "/en/posts" && url.searchParams.get("q") === "no-match-shibei-ui-93841"
  );
  await ready(page, ".publication-page-intro h1");
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.equal(await page.locator(".publication-post-search").getAttribute("action"), "/en/posts");
  assert.match(await page.locator("h1").innerText(), /Find your next good read/);
  pass("language switching preserves query and localized search actions");

  await page.goto(`${base}/zh/posts`);
  await ready(page, ".publication-page-intro h1");
  if (allCards > 0) {
    await page.getByRole("button", { name: "列表布局", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector(".publication-collection-grid")?.getAttribute("data-layout") === "list"
    );
    await page.reload();
    await ready(page, ".publication-collection-grid");
    await page.waitForFunction(
      () => document.querySelector(".publication-collection-grid")?.getAttribute("data-layout") === "list"
    );
    await screenshot(page, "posts-list");
    await page.getByRole("button", { name: "网格布局", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector(".publication-collection-grid")?.getAttribute("data-layout") === "grid"
    );
    pass("grid/list switching survives reloads");
    const cover = page.locator(".story-cover-image").first();
    if (await cover.count()) {
      await cover.scrollIntoViewIfNeeded();
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".story-cover-image")].some(
          (img) => img.complete && img.naturalWidth > 0
        )
      );
      pass("real article covers load alongside decorative cover fallbacks");
    }
    await page.goto(`${base}/en/posts`);
    await ready(page, ".publication-collection-grid");
    const next = page.locator('.pagination-row a[rel="next"]');
    if (await next.count()) {
      const nextHref = await next.getAttribute("href");
      assert.ok(nextHref.startsWith("/en/posts?"), nextHref);
      await next.click();
      await page.waitForURL(`${base}${nextHref}`);
      await ready(page, ".publication-collection-grid");
      assert.ok(
        (await page.locator('.pagination-row a[rel="prev"]').getAttribute("href")).startsWith("/en/posts")
      );
      pass("pagination preserves the English route");
    }
    await page.goto(`${base}/en/posts?page=99999`);
    await ready(page, ".publication-page-intro h1");
    assert.ok(page.url().includes("/en/posts"));
    assert.notEqual(new URL(page.url()).searchParams.get("page"), "99999");
    pass("out-of-range pages redirect within the current language");
    await page.goto(`${base}/zh/posts`);
    await ready(page, ".publication-collection-grid");

    if ((await page.locator(".publication-topics a").count()) > 1) {
      const topicLink = page.locator(".publication-topics a").nth(1);
      const target = await topicLink.getAttribute("href");
      await topicLink.click();
      await page.waitForURL(`${base}${target}`);
      await ready(page, ".story-card");
      assert.ok(await page.locator('.publication-topics a[aria-current="page"]').count());
      pass("topic navigation and active filter state");
    }
    const story = await page.locator(".story-title-link").first().getAttribute("href");
    await page.goto(`${base}${story}`);
    await ready(page, "[data-reading-content]");
    await screenshot(page, "article-desktop");
    const canScroll = await page
      .locator("[data-reading-content]")
      .evaluate((el) => el.clientHeight > innerHeight);
    if (canScroll) {
      await page
        .locator("[data-reading-content]")
        .evaluate((el) =>
          window.scrollTo({
            top: el.getBoundingClientRect().top + scrollY + el.clientHeight / 2,
            behavior: "instant"
          })
        );
      await page.locator(".publication-reading-dock:not([hidden])").waitFor({ state: "visible" });
      const progress = Number(
        await page.getByRole("progressbar", { name: "文章阅读进度" }).getAttribute("aria-valuenow")
      );
      assert.ok(progress > 0 && progress <= 100);
      await page.getByRole("button", { name: "回到顶部", exact: true }).click();
      await page.waitForFunction(() => scrollY < 5);
      pass("article-based progress and back-to-top action");
    }
    await desktop.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.locator(".publication-copy").click();
    await page.waitForFunction(() =>
      document.querySelector(".publication-copy")?.textContent.includes("已复制")
    );
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${base}${story}`);
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error("test permission denial");
          }
        }
      })
    );
    await page.locator(".publication-copy").click();
    await page.locator(".publication-copy-fallback").waitFor({ state: "visible" });
    assert.equal(await page.locator(".publication-copy-fallback").inputValue(), `${base}${story}`);
    pass("share confirmation and honest clipboard-denied fallback");
  }

  await page.goto(`${base}/zh`);
  await ready(page, ".hero-scene");
  for (const width of [1440, 1024, 768, 700, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await assertFits(page, `home ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot(page, "home-mobile");
  await page.locator(".publication-menu-trigger").click();
  await page.locator("dialog[open]").waitFor({ state: "visible" });
  await screenshot(page, "mobile-navigation");
  await page.locator(".publication-mobile-nav").getByRole("link", { name: "02 文章" }).click();
  await page.waitForURL(`${base}/zh/posts`);
  await ready(page, ".publication-page-intro h1");
  assert.equal(await page.locator("dialog[open]").count(), 0);
  await page.waitForFunction(() => document.documentElement.style.overflow !== "hidden");
  await assertFits(page, "mobile posts");
  await screenshot(page, "posts-mobile");
  pass("responsive layout at 320–1440px and mobile navigation cleanup");

  for (const route of ["about", "community"]) {
    for (const language of ["zh", "en"]) {
      const result = await page.goto(`${base}/${language}/${route}`);
      assert.equal(result.status(), 200);
      await ready(page, "main h1");
      await assertFits(page, `${route} ${language} mobile`);
      assert.equal(
        await page.locator('link[rel="canonical"]').getAttribute("href"),
        `${base}/${language}/${route}`
      );
    }
    await screenshot(page, `${route}-mobile`);
  }
  pass("about and community routes stay responsive and localize metadata");

  await page.goto(`${base}/en`);
  await ready(page, ".hero-scene");
  await assertFits(page, "English home mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await screenshot(page, "home-english");
  for (const ui of ["classic", "glass", "editorial", "paper", "firefly", "meow", "cyber", "dynamic"]) {
    await page.evaluate((style) => (document.documentElement.dataset.ui = style), ui);
    for (const theme of ["apple", "dark"]) {
      await page.evaluate((color) => (document.documentElement.dataset.theme = color), theme);
      await assertFits(page, `${ui}/${theme}`);
    }
  }
  await page.evaluate(() => {
    document.documentElement.dataset.ui = "classic";
    document.documentElement.dataset.theme = "dark";
  });
  await screenshot(page, "home-dark");
  pass("English rendering and specialty/dark theme layout compatibility");

  const reduced = await context({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
  const calm = await reduced.newPage();
  await calm.goto(`${base}/zh`);
  await ready(calm, ".hero-scene");
  assert.equal(
    await calm.locator(".scene-sculpture").evaluate((el) => getComputedStyle(el).animationName),
    "none"
  );
  assert.equal(
    await calm.locator(".publication-hero-copy").evaluate((el) => getComputedStyle(el).opacity),
    "1"
  );
  await calm.getByRole("button", { name: "启用动效（遵循系统偏好）", exact: true }).click();
  assert.equal(
    await calm.locator(".scene-sculpture").evaluate((el) => getComputedStyle(el).animationName),
    "none"
  );
  pass("system reduced-motion cannot be overridden by the animation toggle");

  const noJs = await context({ javaScriptEnabled: false });
  const staticPage = await noJs.newPage();
  for (const language of ["zh", "en"]) {
    await staticPage.goto(`${base}/${language}`);
    assert.ok(await staticPage.locator(".publication-hero h1").isVisible());
    assert.equal(await staticPage.locator(".story-card").count(), allCards);
    await staticPage.goto(`${base}/${language}/posts`);
    assert.equal(
      await staticPage.locator(".publication-post-search").getAttribute("action"),
      `/${language}/posts`
    );
    assert.ok(await staticPage.locator(".publication-noscript").isVisible());
  }
  pass("SSR remains readable with JavaScript disabled in both languages");
  assert.deepEqual(errors, [], `Browser runtime errors: ${errors.join("\n")}`);
  pass("no browser runtime or hydration errors");
  console.log(`\n${checks} checks passed. Screenshots: ${artifacts}`);
} finally {
  await Promise.all(contexts.map((ctx) => ctx.close()));
  await browser.close();
}
