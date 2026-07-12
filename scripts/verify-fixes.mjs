// 本次修复的针对性巡检：图表刻度 / 双语切换 / dek / admin 图表 / 弹层关闭。
// 用法: BASE_URL=http://127.0.0.1:3105 node scripts/verify-fixes.mjs
import { createRequire } from "module";
const require = createRequire("/home/app/ShiBei/package.json");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:3105";
const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? `  | ${extra}` : ""}`);
};

async function visibleTexts(page) {
  return page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = (node.textContent || "").trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el || (el.checkVisibility && !el.checkVisibility())) continue;
      out.push(text);
    }
    return out;
  });
}

// 本次修过的固定 UI 文案：en 模式下绝不能可见
const ZH_FIXED = ["总条目", "文章 · 当天", "暂无分类数据", "分类详情", "当天 24 小时分布", "生成于", "单篇文章", "每日合集"];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(20000);

  // 1. /stats 中文模式：Y 轴刻度整数、不重复
  await page.goto(`${BASE}/stats`, { waitUntil: "networkidle" });
  const perChart = await page.$$eval("svg.chart-bar, svg.chart-line", (svgs) =>
    svgs.map((svg) => Array.from(svg.querySelectorAll("text")).map((t) => (t.textContent || "").trim()).filter((t) => /^\d+$/.test(t))));
  ok("stats: 图表轴刻度存在", perChart.length > 0 && perChart.every((l) => l.length >= 2), JSON.stringify(perChart));
  const dup = perChart.filter((l) => new Set(l).size !== l.length);
  ok("stats: 单图刻度无重复", dup.length === 0, dup.length ? JSON.stringify(dup) : "");
  ok("stats: 刻度全为整数", perChart.flat().every((t) => !t.includes(".")));
  await page.screenshot({ path: "/tmp/verify-stats-zh.png", fullPage: true });
  const zhTexts = await visibleTexts(page);
  ok("stats(zh): 英文图例不可见", !zhTexts.includes("Total") && !zhTexts.some((t) => /^Posts · /.test(t)));

  // 2. /stats 英文模式：固定中文文案全隐藏
  await page.evaluate(() => document.documentElement.setAttribute("data-language", "en"));
  await page.waitForTimeout(300);
  const enTexts = await visibleTexts(page);
  const leak = ZH_FIXED.filter((s) => enTexts.some((t) => t.includes(s)));
  ok("stats(en): 固定中文文案全部隐藏", leak.length === 0, leak.join(" / "));
  await page.screenshot({ path: "/tmp/verify-stats-en.png", fullPage: true });
  await page.evaluate(() => document.documentElement.removeAttribute("data-language"));

  // 3. 文章详情 dek 双语显隐
  await page.goto(`${BASE}/posts`, { waitUntil: "networkidle" });
  const href = await page.$eval('a[href^="/posts/"]', (a) => a.getAttribute("href")).catch(() => null);
  if (href) {
    await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
    const leadZh = await page.evaluate(() => Array.from(document.querySelectorAll("p.lead")).map((p) => ({ cls: p.className, vis: p.checkVisibility?.() ?? true, disp: getComputedStyle(p).display })));
    ok("article(zh): 英文 dek 隐藏", !leadZh.some((l) => l.cls.includes("i18n-en") && l.vis), JSON.stringify(leadZh));
    await page.evaluate(() => document.documentElement.setAttribute("data-language", "en"));
    await page.waitForTimeout(200);
    const leadEn = await page.evaluate(() => Array.from(document.querySelectorAll("p.lead")).map((p) => ({ cls: p.className, vis: p.checkVisibility?.() ?? true, disp: getComputedStyle(p).display })));
    const enVisible = leadEn.filter((l) => l.cls.includes("i18n-en") && l.vis);
    ok("article(en): 英文 dek 可见且块级(display:revert)", leadEn.every((l) => !l.cls.includes("i18n-zh") || !l.vis) && enVisible.every((l) => l.disp === "block"), JSON.stringify(leadEn));
    await page.evaluate(() => document.documentElement.removeAttribute("data-language"));
  } else ok("article: 找到文章链接", false);

  // 4. 弹层关闭：点外 + Escape 聚焦回触发钮
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const trigger = await page.$(".theme-switcher-trigger");
  if (trigger) {
    await trigger.click();
    ok("popover: 点击打开", (await page.$eval("#theme-switcher-menu", (el) => el.hidden)) === false);
    await page.mouse.click(10, 500);
    await page.waitForTimeout(150);
    ok("popover: 点外关闭", (await page.$eval("#theme-switcher-menu", (el) => el.hidden)) === true);
    await trigger.click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    const hidden = await page.$eval("#theme-switcher-menu", (el) => el.hidden);
    const focus = await page.evaluate(() => document.activeElement?.className || "");
    ok("popover: Escape 关闭并聚焦回触发钮", hidden === true && focus.includes("theme-switcher-trigger"), `focus=${focus}`);
  } else ok("popover: 找到触发钮", false);

  // 5. admin 登录 + /admin/stats 图表
  await page.goto(`${BASE}/admin/login`, { waitUntil: "networkidle" });
  if (await page.$('input[name="username"]')) {
    await page.fill('input[name="username"]', process.env.ADMIN_USER || "admin");
    await page.fill('input[name="password"]', process.env.ADMIN_PASS || "demo-admin-pass");
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle" }), page.click('button[type="submit"]')]);
    ok("admin: 登录跳转", page.url().includes("/admin") && !page.url().includes("login"), page.url());
    await page.goto(`${BASE}/admin/stats`, { waitUntil: "networkidle" });
    const ac = await page.$$eval("svg.chart-bar, svg.chart-line", (svgs) =>
      svgs.map((svg) => Array.from(svg.querySelectorAll("text")).map((t) => (t.textContent || "").trim()).filter((t) => /^\d+$/.test(t))));
    ok("admin/stats: 图表刻度无重复", ac.length > 0 && ac.every((l) => new Set(l).size === l.length), JSON.stringify(ac));
    await page.screenshot({ path: "/tmp/verify-admin-stats.png", fullPage: true });
  } else ok("admin: 登录表单存在", false);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== ${results.length - failed.length}/${results.length} PASS =====`);
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await browser.close();
}
