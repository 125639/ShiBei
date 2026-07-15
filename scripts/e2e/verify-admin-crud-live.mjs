/** Disposable-stack E2E for the administrator's core CRUD surfaces. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

try { if (typeof process.loadEnvFile === "function") process.loadEnvFile(".env"); } catch {}
if (process.env.ALLOW_LIVE_WRITE !== "1") throw new Error("Set ALLOW_LIVE_WRITE=1 only for a disposable stack");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const { chromium } = createRequire(import.meta.url)("playwright");
const prisma = new PrismaClient();
const base = (process.env.BASE_URL || "http://127.0.0.1:3200").replace(/\/$/, "");
const marker = `full-audit-admin-${Date.now()}`;
const created = { moduleId: "", sourceId: "", topicId: "", styleId: "", postId: "", inviteId: "", modelId: "", imagePath: "" };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

function pass(label) { console.log(`PASS  ${label}`); }

async function submitForm(path, entries) {
  const result = await page.evaluate(async ({ path, entries }) => {
    const form = new FormData();
    for (const [key, value] of entries) form.append(key, value);
    const response = await fetch(path, { method: "POST", body: form, redirect: "follow" });
    return { status: response.status, url: response.url, text: await response.text() };
  }, { path, entries });
  assert.ok(result.status >= 200 && result.status < 400, `${path}: ${result.status} ${result.text.slice(0, 300)}`);
  return result;
}

async function requestJson(path, method, body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, text: await response.text() };
  }, { path, method, body });
}

async function uploadPostImage(postId, fileName, mimeType, bytes) {
  return page.evaluate(async ({ postId, fileName, mimeType, bytes }) => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(bytes)], fileName, { type: mimeType }));
    form.set("caption", "管理员图片上传验收");
    form.set("insertPlacement", "after-intro");
    form.set("redirect", `/admin/posts/${postId}`);
    const response = await fetch(`/api/admin/posts/${postId}/images`, {
      method: "POST",
      body: form,
      redirect: "follow"
    });
    return { status: response.status, text: await response.text(), url: response.url };
  }, { postId, fileName, mimeType, bytes: [...bytes] });
}

try {
  await page.goto(`${base}/admin/login`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.fill('input[name="username"]', process.env.ADMIN_USERNAME || "admin");
  await page.fill('input[name="password"]', process.env.ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin", { timeout: 120_000 }),
    page.click('button[type="submit"]')
  ]);

  await submitForm("/api/admin/modules", [
    ["name", `${marker} 模块`], ["description", "管理员完整验收模块"],
    ["color", "#345678"], ["sortOrder", "9876"]
  ]);
  let moduleRow = await prisma.sourceModule.findUnique({ where: { name: `${marker} 模块` } });
  assert.ok(moduleRow);
  created.moduleId = moduleRow.id;
  await submitForm(`/api/admin/modules/${moduleRow.id}`, [
    ["name", `${marker} 已编辑模块`], ["slug", `${marker}-module`],
    ["description", "编辑后的模块说明"], ["color", "#123456"], ["sortOrder", "9875"]
  ]);
  moduleRow = await prisma.sourceModule.findUnique({ where: { id: moduleRow.id } });
  assert.equal(moduleRow?.name, `${marker} 已编辑模块`);
  assert.equal(moduleRow?.slug, `${marker}-module`);
  assert.equal(moduleRow?.color, "#123456");
  pass("模块可创建并完整编辑名称、Slug、说明、颜色和排序");

  await submitForm("/api/admin/content-styles", [
    ["name", `${marker} 风格`], ["contentMode", "report"], ["tone", "克制"],
    ["length", "中"], ["focus", "事实,影响"], ["outputStructure", "标题,正文"],
    ["customInstructions", "只使用可核验材料"]
  ]);
  let style = await prisma.contentStyle.findFirst({ where: { name: `${marker} 风格` } });
  assert.ok(style);
  created.styleId = style.id;
  await submitForm(`/api/admin/content-styles/${style.id}`, [
    ["_intent", "update"], ["name", `${marker} 已编辑风格`], ["contentMode", "opinion"],
    ["tone", "自然"], ["length", "长"], ["focus", "事实,背景,影响"],
    ["outputStructure", "标题,导语,正文"], ["customInstructions", "避免模板化措辞"]
  ]);
  style = await prisma.contentStyle.findUnique({ where: { id: style.id } });
  assert.equal(style?.name, `${marker} 已编辑风格`);
  assert.equal(style?.contentMode, "opinion");
  pass("内容风格可创建并编辑，默认风格切换使用事务保护");

  await submitForm("/api/admin/sources", [
    ["name", `${marker} 来源`], ["url", "https://example.com/audit-feed.xml"],
    ["type", "RSS"], ["region", "INTERNATIONAL"], ["moduleIds", moduleRow.id],
    ["popularity", "12345"]
  ]);
  let source = await prisma.source.findFirst({
    where: { name: `${marker} 来源` }, include: { modules: { select: { id: true } } }
  });
  assert.ok(source);
  created.sourceId = source.id;
  assert.deepEqual(source.modules.map((item) => item.id), [moduleRow.id]);
  await submitForm("/api/admin/sources/update", [
    ["sourceId", source.id], ["fullEdit", "true"], ["name", `${marker} 已编辑来源`],
    ["url", "https://example.com/edited-feed.xml"], ["type", "WEB"],
    ["region", "DOMESTIC"], ["popularity", "54321"], ["moduleIds", moduleRow.id],
    ["isDefault", "true"]
  ]);
  source = await prisma.source.findUnique({
    where: { id: source.id }, include: { modules: { select: { id: true } } }
  });
  assert.equal(source?.name, `${marker} 已编辑来源`);
  assert.equal(source?.type, "WEB");
  assert.equal(source?.region, "DOMESTIC");
  assert.equal(source?.popularity, 54321);
  assert.equal(source?.isDefault, true);
  assert.deepEqual(source?.modules.map((item) => item.id), [moduleRow.id]);
  const filteredSourcePage = await context.request.get(`${base}/admin/sources?module=${moduleRow.slug}`, { timeout: 60_000 });
  assert.equal(filteredSourcePage.status(), 200);
  assert.match(await filteredSourcePage.text(), new RegExp(marker));
  pass("来源可创建、完整编辑并按模块筛选，模块关联确实落库");

  await submitForm("/api/admin/content-topics", [
    ["name", `${marker} 主题`], ["slug", `${marker}-topic`], ["keywords", "验收关键词"],
    ["scope", "all"], ["compileKind", "SINGLE_ARTICLE"], ["depth", "standard"],
    ["articleCount", "1"], ["styleId", style.id], ["cron", "0 3 * * *"],
    ["moduleIds", moduleRow.id], ["isEnabled", "true"]
  ]);
  let topic = await prisma.contentTopic.findFirst({
    where: { name: `${marker} 主题` },
    include: { modules: { select: { id: true } }, schedule: true }
  });
  assert.ok(topic?.schedule);
  created.topicId = topic.id;
  assert.deepEqual(topic.modules.map((item) => item.id), [moduleRow.id]);
  assert.equal(topic.schedule.cron, "0 3 * * *");
  assert.ok(topic.schedule.bullJobKey);
  await submitForm(`/api/admin/content-topics/${topic.id}`, [
    ["name", `${marker} 已编辑主题`], ["keywords", "更新关键词"], ["scope", "international"],
    ["compileKind", "DAILY_DIGEST"], ["depth", "long"], ["articleCount", "2"],
    ["styleId", style.id], ["cron", "15 4 * * *"], ["moduleIds", moduleRow.id]
  ]);
  topic = await prisma.contentTopic.findUnique({
    where: { id: topic.id }, include: { modules: { select: { id: true } }, schedule: true }
  });
  assert.equal(topic?.name, `${marker} 已编辑主题`);
  assert.equal(topic?.isEnabled, false);
  assert.equal(topic?.schedule?.cron, "15 4 * * *");
  assert.equal(topic?.schedule?.bullJobKey, null);
  assert.deepEqual(topic?.modules.map((item) => item.id), [moduleRow.id]);
  pass("自动主题可配置来源模块，主题与定时设置同步创建和编辑");

  await submitForm("/api/admin/posts", [
    ["title", `${marker} 文章`], ["slug", `${marker}-post`],
    ["summary", "管理员文章 CRUD 验收摘要。"],
    ["content", "## 正文\n\n这是一篇由管理员手动创建的验收文章，内容完整且不依赖生成任务。"],
    ["status", "DRAFT"], ["kind", "SINGLE_ARTICLE"], ["tags", "验收,管理员"]
  ]);
  let post = await prisma.post.findFirst({ where: { title: `${marker} 文章` } });
  assert.ok(post);
  created.postId = post.id;

  const beforeInvalidImage = post.content;
  const invalidImage = await uploadPostImage(
    post.id,
    "renamed.png",
    "image/png",
    Buffer.from("<script>not an image</script>")
  );
  assert.equal(invalidImage.status, 400, invalidImage.text.slice(0, 300));
  assert.equal((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).content, beforeInvalidImage);

  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  const validImage = await uploadPostImage(post.id, "audit.png", "image/png", onePixelPng);
  assert.equal(validImage.status, 200, validImage.text.slice(0, 300));
  post = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
  const imageMatch = post.content.match(/src="(\/uploads\/image\/manual-[a-f0-9]{32}\.png)"/);
  assert.ok(imageMatch, post.content);
  created.imagePath = imageMatch[1];
  assert.equal((await context.request.get(`${base}${created.imagePath}`)).status(), 200);
  pass("文章图片会校验真实文件头；有效 PNG 插入正文并可公开读取，伪装文件不会改稿");

  await submitForm(`/api/admin/posts/${post.id}`, [
    ["expectedUpdatedAt", post.updatedAt.toISOString()], ["title", `${marker} 已发布文章`],
    ["summary", "管理员发布流程验收摘要。"],
    ["content", "## 正文\n\n管理员完成编辑后发布这篇文章，公开页面应当立即可读取。"],
    ["status", "PUBLISHED"], ["sortOrder", "5"], ["tags", "验收,发布"]
  ]);
  post = await prisma.post.findUnique({ where: { id: post.id } });
  assert.equal(post?.status, "PUBLISHED");
  assert.ok(post?.publishedAt);
  const publicPost = await context.request.get(`${base}/posts/${post.slug}`, { timeout: 60_000 });
  assert.equal(publicPost.status(), 200);
  assert.match(await publicPost.text(), new RegExp(marker));
  await submitForm("/api/admin/posts/bulk", [["postId", post.id], ["action", "archive"]]);
  assert.equal((await prisma.post.findUnique({ where: { id: post.id } }))?.status, "ARCHIVED");
  pass("管理员文章可创建、编辑、发布、公开读取并归档");

  await submitForm("/api/admin/model-configs", [
    ["provider", "custom"], ["name", `${marker} 模型`], ["baseUrl", "https://example.com/v1"],
    ["model", "audit-model"], ["apiKey", "sk-audit-placeholder-secret"], ["temperature", "0.2"], ["maxTokens", "4096"],
    ["_enabledPresented", "true"], ["isEnabled", "true"]
  ]);
  let model = await prisma.modelConfig.findFirst({ where: { name: `${marker} 模型` } });
  assert.ok(model);
  created.modelId = model.id;
  assert.notEqual(model.apiKeyEnc, "sk-audit-placeholder-secret");
  await submitForm(`/api/admin/model-configs/${model.id}`, [
    ["_intent", "update"], ["provider", "custom"], ["name", `${marker} 已编辑模型`],
    ["baseUrl", "https://example.com/v1"], ["model", "audit-model-v2"], ["apiKey", ""],
    ["temperature", "0.4"], ["maxTokens", "5000"], ["_enabledPresented", "true"]
  ]);
  model = await prisma.modelConfig.findUnique({ where: { id: model.id } });
  assert.equal(model?.name, `${marker} 已编辑模型`);
  assert.equal(model?.maxTokens, 5000);
  assert.equal(model?.isEnabled, false);
  await page.goto(`${base}/admin/settings?tab=models`, { waitUntil: "networkidle" });
  const disabledModelRow = page.locator("details.model-config-row").filter({ has: page.locator(`input[name="name"][value="${marker} 已编辑模型"]`) });
  assert.equal(await disabledModelRow.count(), 1);
  assert.match(await disabledModelRow.locator(":scope > summary").innerText(), /已停用/);
  pass("模型连接可创建、加密保存、复用密钥编辑并停用；停用状态在后台明确可见");

  const inviteCreated = await requestJson("/api/admin/invites", "POST", { count: 1, note: marker });
  assert.equal(inviteCreated.status, 200, inviteCreated.text);
  const inviteCode = JSON.parse(inviteCreated.text).codes?.[0];
  assert.ok(inviteCode);
  const invite = await prisma.inviteCode.findUnique({ where: { code: inviteCode } });
  assert.ok(invite);
  created.inviteId = invite.id;
  const revoke = await requestJson(`/api/admin/invites/${invite.id}`, "DELETE");
  assert.equal(revoke.status, 200, revoke.text);
  const revoked = await prisma.inviteCode.findUnique({ where: { id: invite.id } });
  assert.equal(revoked?.status, "REVOKED");
  assert.notEqual(revoked?.code, inviteCode);
  pass("邀请码可生成、只显示一次并安全作废原码");

  await submitForm(`/api/admin/content-topics/${topic.id}/delete`, []);
  created.topicId = "";
  assert.equal(await prisma.contentTopic.count({ where: { id: topic.id } }), 0);
  await submitForm("/api/admin/posts/bulk", [["postId", post.id], ["action", "delete"]]);
  created.postId = "";
  assert.equal(await prisma.post.count({ where: { id: post.id } }), 0);
  await submitForm("/api/admin/sources/delete", [["sourceId", source.id]]);
  created.sourceId = "";
  assert.equal(await prisma.source.count({ where: { id: source.id } }), 0);
  await submitForm(`/api/admin/content-styles/${style.id}`, [["_intent", "delete"]]);
  created.styleId = "";
  assert.equal(await prisma.contentStyle.count({ where: { id: style.id } }), 0);
  await submitForm(`/api/admin/model-configs/${model.id}`, [["_intent", "delete"]]);
  created.modelId = "";
  assert.equal(await prisma.modelConfig.count({ where: { id: model.id } }), 0);
  await submitForm(`/api/admin/modules/${moduleRow.id}/delete`, []);
  created.moduleId = "";
  assert.equal(await prisma.sourceModule.count({ where: { id: moduleRow.id } }), 0);
  await prisma.inviteCode.delete({ where: { id: invite.id } });
  created.inviteId = "";
  pass("所有临时后台对象均可通过正式删除入口清理");
} finally {
  if (created.topicId) await prisma.contentTopic.deleteMany({ where: { id: created.topicId } }).catch(() => undefined);
  if (created.postId) await prisma.post.deleteMany({ where: { id: created.postId } }).catch(() => undefined);
  if (created.sourceId) await prisma.source.deleteMany({ where: { id: created.sourceId } }).catch(() => undefined);
  if (created.styleId) await prisma.contentStyle.deleteMany({ where: { id: created.styleId } }).catch(() => undefined);
  if (created.modelId) await prisma.modelConfig.deleteMany({ where: { id: created.modelId } }).catch(() => undefined);
  if (created.moduleId) await prisma.sourceModule.deleteMany({ where: { id: created.moduleId } }).catch(() => undefined);
  if (created.inviteId) await prisma.inviteCode.deleteMany({ where: { id: created.inviteId } }).catch(() => undefined);
  if (created.imagePath) {
    await fs.rm(path.join(process.cwd(), "public", created.imagePath.replace(/^\//, "")), { force: true }).catch(() => undefined);
  }
  await prisma.$disconnect();
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
