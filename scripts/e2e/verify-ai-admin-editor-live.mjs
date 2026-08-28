import assert from "node:assert/strict";
import { createRequire } from "node:module";

try {
  if (typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
} catch {}

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = (process.env.BASE_URL || "").trim().replace(/\/$/, "");
const USERNAME = process.env.ADMIN_USERNAME || "admin";
const PASSWORD = process.env.ADMIN_PASSWORD;
const POST_ID = (process.env.POST_ID || "").trim();
const REPAIR_BATCH_ID = (process.env.REPAIR_BATCH_ID || "").trim();
if (!BASE) throw new Error("BASE_URL is required");
if (!PASSWORD) throw new Error("ADMIN_PASSWORD is required");
if (!/^[A-Za-z0-9_-]{1,120}$/.test(POST_ID)) throw new Error("A valid POST_ID is required");

const browser = await chromium.launch({ headless: true });
const errors = [];
let checks = 0;

function pass(label) {
  checks += 1;
  console.log(`PASS  ${label}`);
}

function watch(page) {
  page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.stack || error.message}`));
}

async function login(page) {
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="username"]', USERNAME);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin"),
    page.click('button[type="submit"]')
  ]);
}

try {
  const desktop = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1600, height: 1050 }
  });
  const page = await desktop.newPage();
  page.setDefaultTimeout(90_000);
  watch(page);
  await login(page);

  await page.goto(`${BASE}/admin/settings?tab=models`, { waitUntil: "networkidle" });
  await page.locator(".model-config-manager").waitFor({ state: "visible" });
  const rendered = await page.content();
  assert.doesNotMatch(rendered, /apiKeyEnc|passwordHash|syncTokenEnc/);
  assert.match(rendered, /研究与文章生成/);
  assert.match(rendered, /轻量验证模型/);
  pass("模型页不向浏览器泄露密钥字段，并明确展示任务路由与轻量验证边界");

  const firstConfig = page.locator("details.model-config-row").first();
  await firstConfig.locator(":scope > summary").click();
  const fetchButton = firstConfig.getByRole("button", { name: "获取模型列表", exact: true });
  const [modelsResponse] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/api/admin/model-configs/test")
      && response.request().method() === "POST"
    ),
    fetchButton.click()
  ]);
  const modelsPayload = await modelsResponse.json();
  assert.equal(modelsResponse.ok(), true, JSON.stringify(modelsPayload));
  assert.equal(modelsPayload.ok, true, JSON.stringify(modelsPayload));
  assert.ok(Array.isArray(modelsPayload.models));
  pass(`已保存 Key 可真实获取模型目录（${modelsPayload.models.length} 个），无需重新回填 Key`);

  const configRows = page.locator("details.model-config-row");
  const configCount = await configRows.count();
  assert.ok(configCount >= 2, "多模型回归至少需要两个已保存连接");
  const probeOutcomes = [];
  for (let index = 0; index < Math.min(configCount, 4); index += 1) {
    const row = configRows.nth(index);
    if (!(await row.evaluate((element) => Boolean(element.open)))) {
      await row.locator(":scope > summary").click();
    }
    const name = await row.locator('input[name="name"]').inputValue();
    const model = await row.locator('input[name="model"]').inputValue();
    const [probeResponse] = await Promise.all([
      page.waitForResponse((response) =>
        response.url().endsWith("/api/admin/model-configs/test")
        && response.request().method() === "POST"
      ),
      row.getByRole("button", { name: "轻量验证模型", exact: true }).click()
    ]);
    const payload = await probeResponse.json();
    if (probeResponse.ok()) {
      assert.equal(payload.ok, true, JSON.stringify(payload));
      assert.match(String(payload.message), /轻量连通验证成功|已被供应商识别/);
      probeOutcomes.push({ name, model, ok: true, message: String(payload.message) });
    } else {
      assert.equal(probeResponse.status(), 502, JSON.stringify(payload));
      assert.equal(payload.ok, false, JSON.stringify(payload));
      const error = String(payload.error || "");
      assert.ok(error.length > 0 && error.length <= 400, JSON.stringify(payload));
      assert.doesNotMatch(error, /Authorization|Bearer\s+|apiKey|stack|node_modules/i);
      probeOutcomes.push({ name, model, ok: false, message: error });
    }
  }
  const availableModels = probeOutcomes.filter((item) => item.ok);
  if (availableModels.length) {
    pass(`逐个实测 ${probeOutcomes.length} 个已配置模型，${availableModels.length} 个当前可用；Chat Completions 端点拼接正确`);
  } else {
    pass(`逐个实测 ${probeOutcomes.length} 个已配置模型；供应商当前均不可用，后台以脱敏错误准确呈现而未误报成功`);
  }
  console.log(`MODEL_PROBES ${JSON.stringify(probeOutcomes)}`);

  if (REPAIR_BATCH_ID) {
    assert.match(REPAIR_BATCH_ID, /^[A-Za-z0-9_-]{1,120}$/);
    await page.goto(`${BASE}/admin/posts`, { waitUntil: "domcontentloaded" });
    await page.evaluate((batchId) => {
      window.localStorage.setItem("shibei:active-post-repair-batch", batchId);
    }, REPAIR_BATCH_ID);
    await page.reload({ waitUntil: "networkidle" });
    const repairPanel = page.locator(".bulk-repair-panel");
    await repairPanel.waitFor({ state: "visible" });
    await repairPanel.getByText("本批次处理完成", { exact: true }).waitFor();
    await repairPanel.locator("details > summary").click();
    await repairPanel.getByText("第 1 轮重新生成：", { exact: false }).waitFor();
    await repairPanel.getByText("已通过并发布", { exact: true }).waitFor();
    assert.match(await repairPanel.innerText(), /已发布 1 篇，停止 0 篇；失败稿未公开。/);
    await page.evaluate(() => {
      window.localStorage.removeItem("shibei:active-post-repair-batch");
    });
    pass("批量返修面板会恢复后台批次，并展示终态、轮次记录和失败稿保护说明");
  }

  await page.goto(`${BASE}/admin/posts/${POST_ID}`, { waitUntil: "networkidle" });
  const workspace = page.locator(".admin-markdown-workspace").first();
  await workspace.waitFor({ state: "visible" });
  const desktopSizes = await workspace.evaluate((root) => ({
    root: root.getBoundingClientRect().width,
    source: root.querySelector("textarea")?.getBoundingClientRect().width || 0,
    preview: root.querySelector(".admin-markdown-preview")?.getBoundingClientRect().width || 0
  }));
  assert.ok(desktopSizes.root > 900, JSON.stringify(desktopSizes));
  assert.ok(desktopSizes.source > 350, JSON.stringify(desktopSizes));
  assert.ok(desktopSizes.preview > 350, JSON.stringify(desktopSizes));
  await workspace.getByRole("button", { name: "只看成稿", exact: true }).click();
  assert.equal(await workspace.locator(".admin-markdown-source-panel").getAttribute("aria-hidden"), "true");
  await workspace.getByRole("button", { name: "只编辑", exact: true }).click();
  assert.equal(await workspace.locator("textarea").getAttribute("aria-hidden"), null);
  pass("文章编辑器在桌面端提供宽双栏、实时成稿预览和清晰的编辑/预览切换");

  const mobile = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    storageState: await desktop.storageState()
  });
  const mobilePage = await mobile.newPage();
  mobilePage.setDefaultTimeout(45_000);
  watch(mobilePage);
  for (const path of ["/admin/settings?tab=models", `/admin/posts/${POST_ID}`]) {
    await mobilePage.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    const overflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const overflowElements = overflow <= 2 ? [] : await mobilePage.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      return Array.from(document.querySelectorAll("body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName.toLowerCase(),
            className: typeof element.className === "string" ? element.className : "",
            width: Math.round(rect.width),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            scrollWidth: element.scrollWidth
          };
        })
        .filter((entry) => entry.right > viewportWidth + 2 || entry.left < -2 || entry.scrollWidth > Math.ceil(entry.width) + 2)
        .sort((a, b) => Math.max(b.right - viewportWidth, b.scrollWidth - b.width) - Math.max(a.right - viewportWidth, a.scrollWidth - a.width))
        .slice(0, 20);
    });
    assert.ok(overflow <= 2, `${path} horizontal overflow=${overflow}; offenders=${JSON.stringify(overflowElements)}`);
  }
  await mobilePage.locator(".admin-markdown-workspace").first().waitFor({ state: "visible" });
  pass("模型配置与文章工作台在 390px 移动端无横向溢出");

  await mobile.close();
  await desktop.close();
  assert.deepEqual(errors, []);
  console.log(`All ${checks} live AI-admin/editor checks passed.`);
} finally {
  await browser.close();
}
