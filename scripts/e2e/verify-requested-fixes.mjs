/**
 * 用户提出的三项修复的真实浏览器验收：
 *   1. 后台批次 / 前台长 AI 请求显示进度；
 *   2. 纯手写默认不调用 AI，主动切换后才允许调用；
 *   3. 前台可发现会员与管理员登录入口（含移动端）。
 *
 * 用法：BASE_URL=http://127.0.0.1:3100 ADMIN_PASS=... node scripts/e2e/verify-requested-fixes.mjs
 */
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { PrismaClient } = require("@prisma/client");

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS;
if (!ADMIN_PASS) throw new Error("ADMIN_PASS is required for the administrator login check");
const prisma = new PrismaClient();
const batchId = `e2e-progress-${Date.now()}`;
let checks = 0;
const pageErrors = [];
let browserPhase = "browser-startup";

function enterBrowserPhase(phase) {
  browserPhase = phase;
}

function rejectPageErrors(page, label) {
  page.on("pageerror", (error) => {
    pageErrors.push(`${label} [phase=${browserPhase}] [${page.url()}]: ${error.stack || error.message}`);
  });
}

function pass(label) {
  checks += 1;
  console.log(`PASS  ${label}`);
}

async function openSlashMenu(page, editor) {
  await page.waitForFunction(() => {
    const element = document.querySelector(".notion-editor .tiptap");
    return element?.getAttribute("contenteditable") === "true";
  });

  // The preceding recovery check deliberately leaves a 60KB single paragraph.
  // A plain End key only reaches the visual line end and is sensitive to where
  // Chromium resolved the click. Control+End models an unambiguous document-end
  // gesture. Retry the gesture itself (not the assertion) because ProseMirror
  // may consume the first key while restoring focus after a React render.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/", { delay: 5 });
    try {
      await page.locator(".slash-menu").waitFor({ state: "visible", timeout: 3_000 });
      return;
    } catch {
      if (await editor.getAttribute("contenteditable") !== "true") {
        throw new Error("斜杠菜单触发期间编辑器意外进入只读状态");
      }
      await page.keyboard.press("Backspace");
    }
  }

  throw new Error("编辑器保持可编辑，但三次真实键盘手势均未打开斜杠菜单");
}

async function seedProgressBatch() {
  await prisma.adminAiBatch.create({
    data: {
      id: batchId,
      request: "E2E 进度条验证任务",
      summary: "E2E 进度条验证批次",
      plan: JSON.stringify({ tasks: [], recurring: [], createdTopics: [] }),
      jobs: {
        create: [
          {
            id: `${batchId}-done`,
            status: "COMPLETED",
            sourceUrl: "keyword://research?keyword=e2e-done&scope=all&count=1&depth=standard",
            sourceType: "EXA",
            completedAt: new Date()
          },
          {
            id: `${batchId}-running`,
            status: "RUNNING",
            sourceUrl: "keyword://research?keyword=e2e-running&scope=all&count=1&depth=standard",
            sourceType: "EXA"
          },
          {
            id: `${batchId}-queued`,
            status: "QUEUED",
            sourceUrl: "keyword://research?keyword=e2e-queued&scope=all&count=1&depth=standard",
            sourceType: "EXA"
          }
        ]
      }
    }
  });
}

async function cleanupProgressBatch() {
  await prisma.fetchJob.deleteMany({ where: { adminAiBatchId: batchId } }).catch(() => undefined);
  await prisma.adminAiBatch.deleteMany({ where: { id: batchId } }).catch(() => undefined);
}

await cleanupProgressBatch();
await seedProgressBatch();

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  rejectPageErrors(page, "主流程");
  page.setDefaultTimeout(20_000);

  // 前台登录入口：会员与管理员入口都必须直接可见，不依赖“探索”折叠菜单。
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const accountLink = page.locator(".header-account-link");
  await accountLink.waitFor({ state: "visible" });
  assert.equal(await accountLink.getAttribute("href"), "/account");
  assert.match(await accountLink.innerText(), /登录\s*\/\s*账户/);
  pass("桌面前台页头直接显示用户登录 / 账户入口");

  const directAdminEntry = page.locator('.nav a[href="/admin/login"]');
  await directAdminEntry.waitFor({ state: "visible" });
  assert.match(await directAdminEntry.innerText(), /管理员后台|Admin/);
  pass("桌面前台主导航直接显示管理员后台入口");

  await accountLink.click();
  await page.waitForURL(`${BASE}/account`);
  const adminEntry = page.locator('.account-admin-entry a[href="/admin/login"]');
  await adminEntry.waitFor({ state: "visible" });
  pass("账户页清晰显示独立的管理员登录入口");

  await adminEntry.click();
  await page.waitForURL(`${BASE}/admin/login`);
  await page.fill('input[name="username"]', ADMIN_USER);
  await page.fill('input[name="password"]', ADMIN_PASS);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin"),
    page.click('button[type="submit"]')
  ]);
  pass("管理员能从前台入口完成登录并进入后台");

  // 用临时 1 完成 + 1 运行 + 1 排队批次验证真实进度，失败/运行不冒充完成。
  await page.goto(`${BASE}/admin/ai`, { waitUntil: "networkidle" });
  const batchCard = page.locator(".admin-ai-batch-card", { hasText: "E2E 进度条验证批次" });
  await batchCard.waitFor({ state: "visible" });
  const compactProgress = batchCard.getByRole("progressbar", { name: "批次进度 1/3" });
  assert.equal(await compactProgress.getAttribute("aria-valuenow"), "1");
  assert.equal(await compactProgress.getAttribute("aria-valuemax"), "3");
  pass("后台批次卡显示真实的 1/3 确定进度");

  await batchCard.click();
  const batchDetail = page.locator(".admin-ai-batch-detail");
  await batchDetail.waitFor({ state: "visible" });
  const detailProgress = batchDetail.getByRole("progressbar", { name: /批次进度：已结束 1\/3/ });
  assert.equal(await detailProgress.getAttribute("aria-valuenow"), "1");
  assert.match(await detailProgress.getAttribute("aria-valuetext") || "", /正在采集资料并生成文章/);
  pass("展开批次可看到当前运行项和所处动作");
  await page.screenshot({ path: "/tmp/shibei-progress-verified.png", fullPage: true });

  // 共创同步 AI 请求没有可查询的内部百分比：验证其诚实展示动作 + 不确定进度。
  await page.route(`${BASE}/api/public/creation/works`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const input = route.request().postDataJSON();
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        work: {
          id: "e2e-creative-work",
          slug: null,
          status: "INTERVIEWING",
          mode: input.mode,
          depth: input.depth,
          topic: input.topic,
          title: "",
          summary: "",
          content: "",
          interview: [],
          pendingQuestion: "请先说说你最想表达的观点？",
          minQuestions: 2,
          maxQuestions: 3,
          genre: { id: input.genreId, slug: "opinion", name: "观点", description: "", dimensions: [], threshold: 70 },
          isAnonymous: true,
          score: null,
          scoreDetail: null,
          publishedAt: null
        }
      })
    });
  });
  // CreationStudio intentionally performs its anonymous bootstrap and private
  // list fetch after hydration. Waiting for the actual UI is the stable product
  // contract; Playwright's global network-idle heuristic can race the second
  // identity recheck that protects cookie deletion during a live tab.
  await page.goto(`${BASE}/create`, { waitUntil: "domcontentloaded" });
  const manualCard = page.locator('a.creation-manual-card[href="/write?mode=manual"]');
  await manualCard.waitFor({ state: "visible" });
  pass("共创的成文模式中直接提供“纯手写”选项");
  await page.fill("#creation-topic", "E2E 验证进度条");
  await page.getByRole("button", { name: "开始访谈" }).click();
  await page.getByRole("progressbar", { name: "正在准备访谈" }).waitFor({ state: "visible" });
  assert.match(await page.locator(".task-progress.is-active").innerText(), /生成第一个具体问题.*已等待/);
  pass("共创长请求显示当前动作、不确定进度与等待时间");

  // 写作台使用假文档 API 精确计数：纯手写只自动保存，不得触发 assist。
  const writePage = await context.newPage();
  rejectPageErrors(writePage, "写作流程");
  writePage.setDefaultTimeout(20_000);
  let assistCalls = 0;
  let saveCalls = 0;
  let completeCalls = 0;
  let handoffCalls = 0;
  let forcePatchConflict = null;
  let failNextDocGet = false;
  let delayNextDocGet = 0;
  let delayNextPatch = 0;
  let delaySecondDocGet = 0;
  let docDeleted = false;
  let doc = {
    id: "e2e-manual-doc",
    title: "",
    content: "",
    completedAt: null,
    creativeWorkId: null,
    publicationBlockedAt: null,
    updatedAt: new Date().toISOString()
  };
  let secondDoc = {
    id: "e2e-manual-doc-second",
    title: "第二份隔离文档",
    content: "这是第二份文档，绝不能混入第一份正文。",
    completedAt: null,
    creativeWorkId: null,
    publicationBlockedAt: null,
    updatedAt: new Date(Date.parse(doc.updatedAt) + 5_000).toISOString()
  };
  await writePage.route(`${BASE}/api/public/writing/docs`, async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          docs: docDeleted
            ? [withoutContent(secondDoc)]
            : [withoutContent(doc), withoutContent(secondDoc)],
          nextCursor: null,
          hasMore: false
        })
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ doc }) });
  });
  await writePage.route(`${BASE}/api/public/writing/docs/${doc.id}`, async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      if (docDeleted) {
        return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "文档不存在" }) });
      }
      if (delayNextDocGet) {
        const delay = delayNextDocGet;
        delayNextDocGet = 0;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (failNextDocGet) {
        failNextDocGet = false;
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "临时无法读取服务器版" })
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ doc }) });
    }
    if (method === "PATCH" || method === "POST") {
      saveCalls += 1;
      const body = route.request().postDataJSON();
      if (delayNextPatch) {
        const delay = delayNextPatch;
        delayNextPatch = 0;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (forcePatchConflict) {
        doc = {
          ...doc,
          ...forcePatchConflict,
          updatedAt: new Date(Date.parse(doc.updatedAt) + 1_000).toISOString()
        };
        forcePatchConflict = null;
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "文档已在其他页面更新" })
        });
      }
      const { expectedUpdatedAt, ...changes } = body;
      if (expectedUpdatedAt !== doc.updatedAt) {
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "文档已在其他页面更新" })
        });
      }
      doc = {
        ...doc,
        ...changes,
        completedAt: null,
        updatedAt: new Date(Date.parse(doc.updatedAt) + 1_000).toISOString()
      };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ doc: withoutContent(doc) }) });
    }
    if (method === "DELETE") {
      const body = route.request().postDataJSON();
      assert.equal(body.expectedUpdatedAt, doc.updatedAt, "删除必须使用刚完成的 PATCH 返回的新版本");
      docDeleted = true;
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fulfill({ status: 204, body: "" });
  });
  await writePage.route(`${BASE}/api/public/writing/docs/${secondDoc.id}`, async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      if (delaySecondDocGet) {
        const delay = delaySecondDocGet;
        delaySecondDocGet = 0;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ doc: secondDoc }) });
    }
    if (method === "PATCH" || method === "POST") {
      const body = route.request().postDataJSON();
      const { expectedUpdatedAt, ...changes } = body;
      if (expectedUpdatedAt !== secondDoc.updatedAt) {
        return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "文档已在其他页面更新" }) });
      }
      secondDoc = {
        ...secondDoc,
        ...changes,
        completedAt: null,
        updatedAt: new Date(Date.parse(secondDoc.updatedAt) + 1_000).toISOString()
      };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ doc: withoutContent(secondDoc) }) });
    }
    return route.fulfill({ status: 204, body: "" });
  });
  await writePage.route(`${BASE}/api/public/writing/docs/${doc.id}/complete`, async (route) => {
    completeCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 500));
    doc = { ...doc, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ doc, alreadySubmitted: false })
    });
  });
  await writePage.route(`${BASE}/api/public/creation/genres`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        genres: [{
          id: "e2e-manual-genre",
          slug: "e2e-manual",
          name: "手写验收题材",
          description: "用于验证下一步",
          dimensions: [],
          threshold: 70
        }],
        depths: {
          SHORT: { label: "快速成文", description: "快速评分" },
          FULL: { label: "深度成文", description: "深度评分" }
        },
        modes: {}
      })
    });
  });
  await writePage.route(`${BASE}/api/public/creation/works/e2e-manual-work`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        work: {
          id: "e2e-manual-work",
          slug: null,
          status: "DRAFT",
          mode: "MANUAL",
          depth: "SHORT",
          topic: doc.title,
          title: doc.title,
          summary: "",
          content: doc.content,
          interview: [],
          pendingQuestion: null,
          minQuestions: 0,
          maxQuestions: 0,
          genre: {
            id: "e2e-manual-genre",
            slug: "e2e-manual",
            name: "手写验收题材",
            description: "用于验证下一步",
            dimensions: [],
            threshold: 70
          },
          isAnonymous: true,
          score: null,
          scoreDetail: null,
          scoreCurrent: false,
          hasHistoricalScore: false,
          scoreRubricCurrent: true,
          moderationReason: null,
          moderationBlocked: false,
          publishedAt: null,
          updatedAt: doc.updatedAt
        }
      })
    });
  });
  await writePage.route(`${BASE}/api/public/writing/docs/${doc.id}/community-draft`, async (route) => {
    handoffCalls += 1;
    const body = route.request().postDataJSON();
    assert.equal(body.expectedUpdatedAt, doc.updatedAt);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workId: "e2e-manual-work",
        status: "DRAFT",
        created: true,
        url: "/create?work=e2e-manual-work"
      })
    });
  });
  await writePage.route(`${BASE}/api/public/writing/assist`, async (route) => {
    assistCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ output: "这是经过用户确认后才可插入的建议。" }) });
  });

  enterBrowserPhase("write-initial-navigation");
  await writePage.goto(`${BASE}/write?mode=manual`, { waitUntil: "domcontentloaded" });
  enterBrowserPhase("write-initial-interaction");
  await writePage.getByRole("button", { name: /纯手写/ }).waitFor({ state: "visible" });
  assert.equal(await writePage.getByRole("button", { name: /纯手写/ }).getAttribute("aria-pressed"), "true");
  await writePage.fill(".writing-title", "我自己的文章");
  const editor = writePage.locator(".notion-editor .tiptap");
  await editor.click();
  await writePage.keyboard.type("这些文字完全由我自己写。", { delay: 20 });
  await writePage.waitForTimeout(1_700);
  assert.ok(saveCalls > 0, "手写内容应自动保存");
  assert.equal(assistCalls, 0, "纯手写期间不应调用 AI");
  assert.equal(await writePage.locator(".bubble-ai").count(), 0);
  pass("纯手写输入会保存，AI 接口调用次数严格为 0");

  const completionClick = writePage.getByTestId("writing-complete-button").click({ noWaitAfter: true });
  await writePage.waitForTimeout(100);
  assert.equal(
    await writePage.locator(".writing-doc-item", { hasText: secondDoc.title }).isDisabled(),
    true,
    "完成请求期间不得切换到另一文档"
  );
  await completionClick;
  await writePage.getByTestId("writing-finish-preview").waitFor({ state: "visible" });
  assert.equal(completeCalls, 1);
  assert.equal(assistCalls, 0, "完成与预览不得调用 AI");
  const nextStep = writePage.getByTestId("writing-submit-community");
  await nextStep.waitFor({ state: "visible" });
  await writePage.waitForFunction(() => {
    const button = document.querySelector('[data-testid="writing-submit-community"]');
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  const handoffClick = nextStep.click({ noWaitAfter: true });
  await writePage.waitForTimeout(100);
  assert.equal(
    await writePage.locator(".writing-doc-item", { hasText: secondDoc.title }).isDisabled(),
    true,
    "社区交接期间不得切换到另一文档"
  );
  await handoffClick;
  try {
    // Do not abort the destination after an arbitrary timer. Wait until the
    // hydrated CreationStudio has completed all three initialization requests
    // and rendered the actual manual-work draft. Interrupting an unfinished
    // streamed navigation can manufacture a React hydration #418 in the test.
    enterBrowserPhase("write-handoff-destination");
    await writePage.waitForURL(`${BASE}/create?work=e2e-manual-work`, { waitUntil: "domcontentloaded" });
    const manualWork = writePage.getByTestId("manual-creative-work");
    await manualWork.waitFor({ state: "visible" });
    await manualWork.getByRole("heading", { name: "纯手写作品草稿" }).waitFor({ state: "visible" });
    // Link prefetches are intentionally allowed to continue in the background,
    // so global network-idle is not a valid readiness signal. Two animation
    // frames after the client-only work view appears let React finish its commit.
    await writePage.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
  } catch (error) {
    const completionError = await writePage.locator(".writing-completion-error, .form-error").allInnerTexts().catch(() => []);
    throw new Error(
      `手写交接未导航（calls=${handoffCalls}, url=${writePage.url()}, errors=${JSON.stringify(completionError)}）`,
      { cause: error }
    );
  }
  assert.equal(handoffCalls, 1);
  assert.equal(assistCalls, 0, "手写交接不得调用 AI");
  enterBrowserPhase("write-return-navigation");
  await writePage.goto(`${BASE}/write?mode=manual`, { waitUntil: "domcontentloaded" });
  enterBrowserPhase("write-return-interaction");
  await writePage.locator(".notion-editor .tiptap").waitFor({ state: "visible" });
  pass("纯手写完成后明确显示并可执行“继续到评分与发布”，交接仍不调用 AI");

  await writePage.getByRole("button", { name: /AI 辅助/ }).click();
  await editor.click();
  await writePage.keyboard.press("Control+A");
  const polish = writePage.locator(".bubble-ai", { hasText: "润色" });
  await polish.waitFor({ state: "visible" });
  await polish.click();
  const aiProgress = writePage.getByRole("progressbar", { name: "AI 正在润色" });
  await aiProgress.waitFor({ state: "visible" });
  assert.equal(assistCalls, 1);
  pass("只有主动开启并选择 AI 后才调用模型，等待时显示进度");
  await writePage.screenshot({ path: "/tmp/shibei-manual-writing-verified.png", fullPage: true });

  // 超过 keepalive/beacon 上限的正文也必须能从同步 localStorage 快照恢复。
  const recoveryKey = `shibei-write-recovery-v1:${doc.id}`;
  const largeRecoveryContent = `本地大稿恢复标记\n${"大".repeat(61_000)}`;
  await writePage.evaluate(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, {
    key: recoveryKey,
    value: {
      version: 1,
      docId: doc.id,
      editorSessionId: "e2e-closed-tab",
      title: "本地恢复的大文稿",
      content: largeRecoveryContent,
      serverUpdatedAt: doc.updatedAt,
      // 故意比服务器时钟落后：恢复依据服务端版本，不比较两台机器时钟。
      localUpdatedAt: "2020-01-01T00:00:00.000Z"
    }
  });
  enterBrowserPhase("write-large-recovery-reload");
  await writePage.reload({ waitUntil: "domcontentloaded" });
  enterBrowserPhase("write-large-recovery-interaction");
  await writePage.locator(".notion-editor .tiptap", { hasText: "本地大稿恢复标记" }).waitFor({ state: "visible" });
  await writePage.waitForTimeout(1_700);
  assert.equal(await writePage.evaluate((key) => localStorage.getItem(key), recoveryKey), null);
  pass("超过 60KB 的未保存正文按同一服务端基线恢复，PATCH 成功后清除快照");

  // 若服务器版已前进，不能自动删除或覆盖本地稿，必须让用户明确选择。
  await writePage.evaluate(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, {
    key: recoveryKey,
    value: {
      version: 1,
      docId: doc.id,
      editorSessionId: "e2e-other-tab",
      title: "冲突的本地标题",
      content: "冲突的本地未保存正文",
      serverUpdatedAt: "2020-01-01T00:00:00.000Z",
      localUpdatedAt: new Date().toISOString()
    }
  });
  enterBrowserPhase("write-conflict-reload");
  await writePage.reload({ waitUntil: "domcontentloaded" });
  enterBrowserPhase("write-conflict-interaction");
  await writePage.getByTestId("writing-recovery-conflict").waitFor({ state: "visible" });
  assert.equal(
    await writePage.locator(".writing-doc-list li.active .writing-doc-delete").isDisabled(),
    true,
    "恢复冲突期间不得删除当前文档"
  );
  assert.ok(await writePage.evaluate((key) => localStorage.getItem(key), recoveryKey));
  await writePage.getByTestId("writing-keep-server").click();
  assert.equal(await writePage.evaluate((key) => localStorage.getItem(key), recoveryKey), null);
  pass("本地稿与新版服务器稿冲突时保留两份，并显示明确的版本选择");

  // 先留下一个已经生成的 AI 建议，随后制造保存冲突。恢复界面出现时
  // 必须销毁旧结果；否则 Tiptap 命令仍可绕过 contenteditable=false 写稿。
  await writePage.getByRole("button", { name: /AI 辅助/ }).click();
  await editor.click();
  await writePage.keyboard.press("Control+A");
  await writePage.locator(".bubble-ai", { hasText: "润色" }).click();
  await writePage.locator(".ai-review-card.status-done").waitFor({ state: "visible" });

  // A→B 切换期间旧 ProseMirror、AI 卡和 body-mounted slash menu 都不能把
  // A 的内容写进 B。刻意延迟 B 的 GET，扩大曾经存在的竞态窗口。
  const saveCallsBeforeSlash = saveCalls;
  await openSlashMenu(writePage, editor);
  // A 61KB recovery paragraph makes a debounced PATCH observably slower on
  // some Chromium runs. Establish the baseline only after the slash edit is
  // durable; otherwise an in-flight legitimate save looks like cross-doc
  // corruption when the assertion samples the mocked server object too early.
  await writePage.waitForFunction(() => {
    const state = document.querySelector(".writing-save-state");
    return state?.classList.contains("state-dirty") || state?.classList.contains("state-saving");
  });
  await writePage.waitForFunction(() =>
    document.querySelector(".writing-save-state")?.classList.contains("state-saved")
  );
  assert.ok(saveCalls > saveCallsBeforeSlash, "打开斜杠菜单产生的正文变更必须先完成保存");
  const firstDocBeforeSwitch = doc.content;
  const secondDocBeforeSwitch = secondDoc.content;
  delaySecondDocGet = 1_000;
  await writePage.locator(".writing-doc-item", { hasText: secondDoc.title }).click();
  await writePage.waitForFunction(() => document.querySelector(".writing-title")?.hasAttribute("readonly"));
  assert.equal(await editor.getAttribute("contenteditable"), "false");
  assert.equal(await writePage.locator(".ai-review-card").count(), 0);
  assert.equal(await writePage.locator(".slash-menu").count(), 0);
  await editor.click();
  await writePage.keyboard.type("这段攻击性输入不能进入任何文档");
  await writePage.locator(".notion-editor .tiptap", { hasText: secondDocBeforeSwitch }).waitFor({ state: "visible" });
  assert.equal(doc.content, firstDocBeforeSwitch);
  assert.equal(secondDoc.content, secondDocBeforeSwitch);
  await writePage.locator(".writing-doc-item", { hasText: doc.title || "无标题" }).click();
  await writePage.locator(".notion-editor .tiptap", {
    hasText: firstDocBeforeSwitch.slice(0, 30).trim()
  }).waitFor({ state: "visible" });
  assert.equal(doc.content, firstDocBeforeSwitch);
  assert.equal(secondDoc.content, secondDocBeforeSwitch);
  pass("延迟跨文档切换时旧编辑器、AI 卡和斜杠菜单均无法造成串稿");

  // 当前标签页 PATCH 收到 409 时必须立刻停止旧版本重试，并现场给出两份稿选择。
  forcePatchConflict = {
    title: "另一标签页的服务器标题",
    content: "另一标签页刚刚保存的服务器正文。"
  };
  failNextDocGet = true;
  await writePage.fill(".writing-title", "当前标签页的本地标题");
  await editor.click();
  await writePage.keyboard.press("Control+A");
  await writePage.keyboard.type("当前标签页尚未保存的本地正文。", { delay: 5 });
  await openSlashMenu(writePage, editor);
  const savesBeforeLocalConflict = saveCalls;
  await writePage.getByTestId("writing-recovery-conflict").waitFor({ state: "visible" });
  assert.equal(
    await writePage.locator(".writing-doc-list li.active .writing-doc-delete").isDisabled(),
    true,
    "PATCH 409 后不得删除尚未选择版本的文档"
  );
  await writePage.getByText(/读取服务器版失败/).waitFor({ state: "visible" });
  assert.equal(await writePage.locator(".ai-review-card").count(), 0, "409 后必须销毁旧 AI 结果卡");
  assert.equal(await writePage.locator(".slash-menu").count(), 0, "409 后必须销毁带旧选区的斜杠菜单");
  assert.equal(
    await writePage.getByRole("button", { name: /AI 辅助/ }).isDisabled(),
    true,
    "恢复冲突期间不得重新启动 AI"
  );
  assert.match(await writePage.locator(".writing-save-state").innerText(), /版本冲突/);
  assert.ok(await writePage.evaluate((key) => localStorage.getItem(key), recoveryKey));
  await writePage.waitForTimeout(5_300);
  assert.equal(saveCalls, savesBeforeLocalConflict + 1, "409 后不得每 5 秒重试旧 revision");

  await writePage.waitForFunction(() => document.querySelector(".notion-editor .tiptap")?.getAttribute("contenteditable") === "false");
  assert.equal(await editor.getAttribute("contenteditable"), "false");
  const preservedLocal = JSON.parse(await writePage.evaluate((key) => localStorage.getItem(key), recoveryKey));
  delayNextDocGet = 900;
  await writePage.getByTestId("writing-restore-local").click();
  await writePage.getByTestId("writing-restore-local").waitFor({ state: "visible" });
  assert.equal(await writePage.getByTestId("writing-restore-local").isDisabled(), true);
  await editor.click();
  await writePage.keyboard.type("等待时不应写入");
  assert.equal(await editor.getAttribute("contenteditable"), "false");
  assert.equal(
    JSON.parse(await writePage.evaluate((key) => localStorage.getItem(key), recoveryKey)).content,
    preservedLocal.content,
    "慢 GET 等待期间不得覆盖原本的本地恢复稿"
  );
  await writePage.getByTestId("writing-complete-button").click();
  await writePage.getByTestId("writing-finish-preview").waitFor({ state: "visible" });
  assert.match(await writePage.getByTestId("writing-finish-preview").innerText(), /当前标签页尚未保存的本地正文/);
  assert.equal(doc.content, preservedLocal.content);
  await writePage.getByRole("button", { name: "返回修改" }).click();
  pass("当前标签页 409 即使首次拉取服务器版失败，也可现场选本地稿、用新 revision 保存并继续预览");

  forcePatchConflict = {
    title: "最终服务器标题",
    content: "最终选择保留的服务器正文。"
  };
  await writePage.fill(".writing-title", "这次不要的本地标题");
  await editor.click();
  await writePage.keyboard.press("Control+A");
  await writePage.keyboard.type("这次选择丢弃的本地正文。", { delay: 5 });
  await writePage.getByTestId("writing-recovery-conflict").waitFor({ state: "visible" });
  assert.equal(
    await writePage.locator(".writing-doc-list li.active .writing-doc-delete").isDisabled(),
    true,
    "服务器冲突选择期间删除按钮必须保持禁用"
  );
  assert.equal(await writePage.locator(".writing-title").getAttribute("readonly"), "");
  await writePage.waitForFunction(() => document.querySelector(".notion-editor .tiptap")?.getAttribute("contenteditable") === "false");
  assert.equal(await editor.getAttribute("contenteditable"), "false");
  const lockedServerText = await editor.innerText();
  await editor.click();
  await writePage.keyboard.type("冲突期间不应覆盖任一版本");
  assert.equal(await editor.innerText(), lockedServerText);
  await writePage.getByTestId("writing-keep-server").click();
  assert.equal(await writePage.evaluate((key) => localStorage.getItem(key), recoveryKey), null);
  assert.match(await editor.innerText(), /最终选择保留的服务器正文/);
  pass("当前标签页 409 后也可明确保留服务器版，不残留旧待保存队列");

  // 删除必须与尚未发出的自动保存串行：先把最新正文 PATCH 成功，再带着
  // PATCH 返回的新 CAS 版本删除，不能因旧 expectedUpdatedAt 误报冲突或丢稿。
  writePage.once("dialog", (dialog) => void dialog.accept());
  delayNextPatch = 800;
  await writePage.fill(".writing-title", "延迟保存后再删除");
  const activeDelete = writePage.locator(".writing-doc-list li.active .writing-doc-delete");
  enterBrowserPhase("write-delete-navigation");
  // 两个异步动作一创建就吸收 rejection，避免中间断言失败并关闭页面时，
  // waitForNavigation 的迟发 rejection 掩盖真正的首个失败原因。
  const deleteNavigation = writePage.waitForNavigation({ waitUntil: "domcontentloaded" })
    .then(() => null, (error) => error);
  const deleteClick = activeDelete.click({ noWaitAfter: true })
    .then(() => null, (error) => error);
  await writePage.waitForTimeout(100);
  assert.equal(await activeDelete.isDisabled(), true, "保存并删除期间按钮必须锁定");
  const [deleteClickError, deleteNavigationError] = await Promise.all([deleteClick, deleteNavigation]);
  if (deleteClickError) throw deleteClickError;
  if (deleteNavigationError) throw deleteNavigationError;
  enterBrowserPhase("write-delete-destination");
  await writePage.locator(".notion-editor .tiptap", { hasText: secondDoc.content }).waitFor({ state: "visible" });
  assert.equal(docDeleted, true);
  assert.equal(doc.title, "延迟保存后再删除");
  pass("删除会等待延迟自动保存，并使用最新版本号完成，不会与 PATCH 竞态");

  // 390px 手机：登录入口仍处于视口内，不能只在桌面可见。
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  rejectPageErrors(mobile, "移动端流程");
  await mobile.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const mobileAccount = mobile.locator(".header-account-link");
  await mobileAccount.waitFor({ state: "visible" });
  const box = await mobileAccount.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390, "手机登录入口应完整位于视口内");
  pass("390px 手机页头仍可见用户登录 / 账户入口");
  await mobile.screenshot({ path: "/tmp/shibei-mobile-login-verified.png", fullPage: false });
  await mobile.close();

  assert.deepEqual(pageErrors, [], `浏览器流程不得产生未处理的页面异常：\n${pageErrors.join("\n")}`);
  pass("全部桌面与移动端流程均无未处理 pageerror");

  console.log(`\nAll ${checks} browser checks passed.`);
} finally {
  await browser.close();
  await cleanupProgressBatch();
  await prisma.$disconnect();
}

function withoutContent(value) {
  return {
    id: value.id,
    title: value.title,
    completedAt: value.completedAt,
    creativeWorkId: value.creativeWorkId,
    publicationBlockedAt: value.publicationBlockedAt,
    updatedAt: value.updatedAt
  };
}
