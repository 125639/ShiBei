/**
 * Disposable-stack E2E for comments, reader preferences, translation,
 * public reading and the page AI assistant. It uses real configured models.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

try { if (typeof process.loadEnvFile === "function") process.loadEnvFile(".env"); } catch {}

if (process.env.ALLOW_LIVE_WRITE !== "1") {
  throw new Error("Set ALLOW_LIVE_WRITE=1 only for a disposable database stack");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const prisma = new PrismaClient();
const base = (process.env.BASE_URL || "http://127.0.0.1:3200").replace(/\/$/, "");
const marker = `full-audit-reader-${Date.now()}`;
const password = `Audit!${Date.now()}xY9`;
const ids = { post: "", owner: "", other: "", comments: [] };
let originalSettings = null;
const contexts = [];
const browser = await chromium.launch({ headless: true });

function pass(label) {
  console.log(`PASS  ${label}`);
}

async function contextWithMember(username) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  contexts.push(context);
  const login = await context.request.post(`${base}/api/member/login`, {
    headers: { Origin: base, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    data: { account: username, secret: password },
    timeout: 60_000
  });
  assert.equal(login.status(), 200, await login.text());
  return context;
}

async function postJson(context, path, data, timeout = 60_000) {
  const response = await context.request.post(`${base}${path}`, {
    headers: { Origin: base, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    data,
    timeout
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { status: response.status(), headers: response.headers(), body, text };
}

try {
  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
  assert.ok(settings);
  originalSettings = {
    commentsEnabled: settings.commentsEnabled,
    assistantModelConfigId: settings.assistantModelConfigId,
    translationModelConfigId: settings.translationModelConfigId
  };
  const model = await prisma.modelConfig.findFirst({
    where: { baseUrl: { contains: "siliconflow" } },
    orderBy: { createdAt: "desc" }
  }) || await prisma.modelConfig.findFirst({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  assert.ok(model, "No model configuration is available");

  const [owner, other, post] = await prisma.$transaction([
    prisma.memberUser.create({
      data: {
        username: `${marker}-owner`.slice(0, 60),
        passwordHash: await bcrypt.hash(password, 10),
        credentialState: "ACTIVE",
        displayName: "读者验收甲"
      }
    }),
    prisma.memberUser.create({
      data: {
        username: `${marker}-other`.slice(0, 60),
        passwordHash: await bcrypt.hash(password, 10),
        credentialState: "ACTIVE",
        displayName: "读者验收乙"
      }
    }),
    prisma.post.create({
      data: {
        slug: marker,
        title: `窗边的一次记录 ${marker}`,
        summary: "一篇用于验证阅读、评论、翻译和助手流程的短文。",
        content: "## 我记录了什么\n\n今天下午，我在窗边观察雨停后的光线，并把变化写进笔记。这个过程提醒我：先看清事实，再写下判断。",
        status: "PUBLISHED",
        kind: "SINGLE_ARTICLE",
        publishedAt: new Date()
      }
    })
  ]);
  ids.owner = owner.id;
  ids.other = other.id;
  ids.post = post.id;
  await prisma.siteSettings.update({
    where: { id: "site" },
    data: {
      commentsEnabled: true,
      assistantModelConfigId: model.id,
      translationModelConfigId: model.id
    }
  });

  const anonymous = await browser.newContext();
  contexts.push(anonymous);
  const anonymousPost = await postJson(anonymous, `/api/public/posts/${post.id}/comments`, { content: "匿名评论" });
  assert.equal(anonymousPost.status, 401);
  pass("未登录读者不能发表评论");

  const ownerContext = await contextWithMember(owner.username);
  const otherContext = await contextWithMember(other.username);
  const hostileText = `<img src=x onerror=window.__commentXss=1> ${marker} 仍按纯文本显示`;
  const created = await postJson(ownerContext, `/api/public/posts/${post.id}/comments`, { content: hostileText });
  assert.equal(created.status, 200, created.text);
  ids.comments.push(created.body.comment.id);

  const page = await ownerContext.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const articleResponse = await page.goto(`${base}/posts/${post.slug}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  assert.equal(articleResponse?.status(), 200);
  await page.locator(".comment-body").filter({ hasText: marker }).waitFor({ timeout: 30_000 });
  assert.equal(await page.locator(".comment-body img").count(), 0);
  assert.equal(await page.evaluate(() => Boolean(window.__commentXss)), false);
  assert.deepEqual(pageErrors, []);
  pass("文章页读取正常，评论中的 HTML/XSS 只按纯文本呈现");

  const forbiddenDelete = await otherContext.request.delete(`${base}/api/public/comments/${created.body.comment.id}`, {
    headers: { Origin: base, "Sec-Fetch-Site": "same-origin" }, timeout: 30_000
  });
  assert.equal(forbiddenDelete.status(), 403);
  pass("会员不能删除他人的评论");

  await page.locator(".comment-item").filter({ hasText: marker }).locator(".comment-delete").click();
  await page.locator(".comment-body").filter({ hasText: marker }).waitFor({ state: "detached", timeout: 30_000 });
  ids.comments = ids.comments.filter((id) => id !== created.body.comment.id);
  assert.equal(await prisma.comment.count({ where: { id: created.body.comment.id } }), 0);
  pass("评论作者可从文章页删除自己的评论");

  const adminDeleteTarget = await postJson(ownerContext, `/api/public/posts/${post.id}/comments`, { content: `${marker} 管理员删除目标` });
  assert.equal(adminDeleteTarget.status, 200, adminDeleteTarget.text);
  ids.comments.push(adminDeleteTarget.body.comment.id);
  const adminContext = await browser.newContext();
  contexts.push(adminContext);
  const adminPage = await adminContext.newPage();
  await adminPage.goto(`${base}/admin/login`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await adminPage.fill('input[name="username"]', process.env.ADMIN_USERNAME || "admin");
  await adminPage.fill('input[name="password"]', process.env.ADMIN_PASSWORD);
  await Promise.all([
    adminPage.waitForURL((url) => url.pathname === "/admin", { timeout: 120_000 }),
    adminPage.click('button[type="submit"]')
  ]);
  const adminDelete = await adminContext.request.delete(`${base}/api/admin/comments/${adminDeleteTarget.body.comment.id}`, {
    headers: { Origin: base, "Sec-Fetch-Site": "same-origin" }, timeout: 30_000
  });
  assert.equal(adminDelete.status(), 200, await adminDelete.text());
  ids.comments = ids.comments.filter((id) => id !== adminDeleteTarget.body.comment.id);
  pass("管理员可删除违规评论");

  const readerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  contexts.push(readerContext);
  const settingsPage = await readerContext.newPage();
  await settingsPage.goto(`${base}/settings`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await settingsPage.locator('.settings-shell:not([aria-busy="true"])').waitFor({ timeout: 30_000 });
  await settingsPage.locator("#settings-language .option-card").filter({ hasText: "English" }).click();
  await settingsPage.locator("#settings-theme .option-card").nth(2).click();
  await settingsPage.locator("#settings-density .option-card").nth(0).click();
  const stored = await settingsPage.evaluate(() => ({
    language: localStorage.getItem("shibei.language"),
    theme: localStorage.getItem("shibei.theme"),
    density: localStorage.getItem("shibei.density")
  }));
  assert.deepEqual(stored, { language: "en", theme: "dark", density: "compact" });
  await settingsPage.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  await settingsPage.locator('.settings-shell:not([aria-busy="true"])').waitFor({ timeout: 30_000 });
  const persisted = await settingsPage.evaluate(() => ({
    lang: document.documentElement.lang,
    theme: document.documentElement.dataset.theme,
    density: document.documentElement.dataset.density,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  }));
  assert.deepEqual(persisted, { lang: "en", theme: "dark", density: "compact", overflow: false });
  pass("手机端读者设置可操作、持久化且无横向溢出");

  let translated = await postJson(readerContext, `/api/public/posts/${post.id}/translate`, { targetLanguage: "en" }, 420_000);
  for (let attempt = 0; translated.status === 202 && attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    translated = await postJson(readerContext, `/api/public/posts/${post.id}/translate`, { targetLanguage: "en" }, 420_000);
  }
  assert.equal(translated.status, 200, translated.text);
  assert.ok(String(translated.body?.title || "").trim());
  assert.ok(String(translated.body?.content || "").trim().length > 30);
  const translatedRow = await prisma.post.findUnique({ where: { id: post.id } });
  assert.ok(translatedRow?.titleEn && translatedRow.contentEn && translatedRow.translatedAt);
  pass("真实模型生成英文版并原子写入翻译缓存");

  await settingsPage.goto(`${base}/posts/${post.slug}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const englishBlock = settingsPage.locator('.localized-article[data-language-block="english"]');
  await englishBlock.waitFor({ timeout: 30_000 });
  assert.ok((await englishBlock.innerText()).trim().length > 30);
  pass("英文偏好读者打开文章时直接读取缓存英文正文");

  const assistantPrompt = "What is the concrete observation described on this page? Answer in one sentence.";
  const assistantResult = await postJson(readerContext, "/api/public/assistant", {
    message: assistantPrompt,
    context: `${post.title}\n${post.summary}\n${post.content}`,
    language: "en"
  }, 240_000);
  assert.equal(assistantResult.status, 200, assistantResult.text);
  assert.ok(String(assistantResult.body?.reply || "").trim().length > 5);
  await settingsPage.route("**/api/public/assistant", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: assistantResult.text });
  }, { times: 1 });
  await settingsPage.getByRole("button", { name: "Open AI assistant" }).click();
  const assistantInput = settingsPage.getByRole("textbox", { name: "AI Assistant Input" });
  await assistantInput.fill(assistantPrompt);
  await settingsPage.getByRole("button", { name: "Send" }).click();
  const assistantMessage = settingsPage.locator(".assistant-message.assistant").last();
  await assistantMessage.waitFor({ timeout: 30_000 });
  assert.ok((await assistantMessage.innerText()).replace(/^AI\s*/, "").trim().length > 5);
  pass("文章页 AI 助手使用真实上下文返回可见回复");

  for (const path of [`/posts/${post.slug}`, `/posts?search=${encodeURIComponent(marker)}`, "/feed.xml", "/sitemap.xml"]) {
    const response = await readerContext.request.get(`${base}${path}`, { timeout: 60_000 });
    assert.equal(response.status(), 200, path);
  }
  pass("文章详情、搜索、Feed 与 Sitemap 公共读取均正常");
} finally {
  for (const context of contexts.reverse()) await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  if (ids.post) await prisma.comment.deleteMany({ where: { postId: ids.post } }).catch(() => undefined);
  if (ids.post) await prisma.post.deleteMany({ where: { id: ids.post } }).catch(() => undefined);
  if (ids.owner || ids.other) {
    await prisma.memberUser.deleteMany({ where: { id: { in: [ids.owner, ids.other].filter(Boolean) } } }).catch(() => undefined);
  }
  if (originalSettings) {
    await prisma.siteSettings.update({ where: { id: "site" }, data: originalSettings }).catch(() => undefined);
  }
  await prisma.$disconnect();
}
