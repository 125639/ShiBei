/**
 * 社区治理的真实 HTTP + PostgreSQL 回归：
 *   - 管理员列表与目标接口都不枚举/治理私有草稿；
 *   - 匿名或普通会员 cookie 不能调用管理员治理 API；
 *   - 管理员可下架匿名 SHARED，旧 slug 立即失效并留下审计；
 *   - 标题+摘要+正文共同构成公开表面；A、B 两轮下架后恢复 A 仍不能评分/发布；
 *   - 永久删除 MANUAL 公开副本时保留私有 WritingDoc，但锁定再次交接；
 *   - 作品删除后审计快照仍持久存在。
 *
 * 用法：BASE_URL=http://127.0.0.1:3100 node scripts/e2e/verify-community-moderation.mjs
 * DATABASE_URL / AUTH_SECRET 必须与被测应用一致，且已部署最新迁移。
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { SignJWT } from "jose";
import { cookieHeaderForAuthValue } from "./auth-cookie-names.mjs";

try {
  if (typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
} catch {
  // 调用方显式提供环境变量时无需读取本地文件。
}

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const marker = `moderation-e2e-${Date.now()}-${randomUUID().slice(0, 8)}`;
const targetWorkIds = [];
let checks = 0;

function pass(label) {
  checks += 1;
  console.log(`PASS  ${label}`);
}

function includesRenderedScore(html, score) {
  const normalized = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\\"/g, '"');
  return new RegExp(`AI 评分\\s*(?:${score}\\b|",\\s*${score}\\b)`).test(normalized);
}

function workScoreFingerprint({ title, summary, content }) {
  return createHash("sha256")
    .update(JSON.stringify([title.trim(), summary.trim(), content.replace(/\r\n?/g, "\n")]), "utf8")
    .digest("hex");
}

function legacyWorkScoreFingerprint({ title, content }) {
  return createHash("sha256")
    .update(JSON.stringify([title.trim(), content.trim()]), "utf8")
    .digest("hex");
}

function workRubricFingerprint({ depth, genre }) {
  let raw;
  try { raw = JSON.parse(genre.dimensions); } catch { raw = []; }
  const dimensions = Array.isArray(raw) ? raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const key = typeof item.key === "string" ? item.key.trim() : "";
    const label = typeof item.label === "string" ? item.label.trim() : "";
    const weight = typeof item.weight === "number" && Number.isFinite(item.weight) ? item.weight : NaN;
    if (!key || !label || !(weight > 0)) return [];
    return [{ key, label, weight, hint: typeof item.hint === "string" ? item.hint.trim() : "" }];
  }) : [];
  return createHash("sha256").update(JSON.stringify({
    depth,
    genreName: genre.name.trim(),
    dimensions,
    threshold: genre.threshold
  }), "utf8").digest("hex");
}

async function jsonRequest(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, { redirect: "manual", ...init });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  return { response, payload, raw: text };
}

async function assertPublicSlugGone(path, forbiddenText) {
  const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
  const body = await response.text();
  // Next.js App Router may have already started a streamed browser response
  // before notFound() resolves. Its documented contract is then HTTP 200 plus
  // a noindex marker and NEXT_HTTP_ERROR_FALLBACK;404, rather than a late 404
  // status. In either form, no part of the moderated surface may be returned.
  if (response.status !== 404) {
    assert.equal(response.status, 200);
    assert.match(body, /NEXT_HTTP_ERROR_FALLBACK;404/);
    assert.match(body, /<meta name="robots" content="noindex"/);
  }
  for (const value of forbiddenText) {
    assert.equal(body.includes(value), false, `已治理公开表面仍出现在旧 slug：${value}`);
  }
}

function postModeration(workId, action, reason, cookie) {
  return jsonRequest(`/api/admin/community-works/${workId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify({ action, reason })
  });
}

function authSecret() {
  const configured = process.env.AUTH_SECRET;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be provided when verifying a production server");
  }
  return new TextEncoder().encode(configured || "dev-auth-secret-change-me");
}

async function adminCookie() {
  const admin = await prisma.adminUser.findFirst({ select: { id: true, tokenVersion: true } });
  assert.ok(admin, "测试库至少需要一个管理员");
  const token = await new SignJWT({ userId: admin.id, ver: admin.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(authSecret());
  return cookieHeaderForAuthValue("adminSession", token);
}

async function memberOnlyCookie() {
  const token = await new SignJWT({ memberId: `fake-${marker}`, ver: 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(authSecret());
  return cookieHeaderForAuthValue("memberSession", token);
}

let manualSourceDocId;
let sharedSlug;
let manualSlug;

try {
  const genre = await prisma.creationGenre.findFirst({ where: { isEnabled: true } });
  assert.ok(genre, "测试库至少需要一个启用题材（先运行 db:seed）");

  const privateWork = await prisma.creativeWork.create({
    data: {
      ownerId: null,
      anonId: randomUUID(),
      genreId: genre.id,
      mode: "VOICE_FIRST",
      depth: "SHORT",
      status: "DRAFT",
      topic: marker,
      title: `${marker} private`,
      content: "private content"
    }
  });
  targetWorkIds.push(privateWork.id);

  sharedSlug = `${marker}-anonymous`;
  const sharedTitle = `${marker} anonymous public`;
  const sharedSummary = "public moderation probe";
  const sharedContent = "public content";
  const sharedWork = await prisma.creativeWork.create({
    data: {
      ownerId: null,
      anonId: randomUUID(),
      genreId: genre.id,
      mode: "AI_FIRST",
      depth: "SHORT",
      status: "SHARED",
      topic: marker,
      title: sharedTitle,
      summary: sharedSummary,
      content: sharedContent,
      slug: sharedSlug,
      score: 88,
      scoredAt: new Date(),
      scoredHash: legacyWorkScoreFingerprint({ title: sharedTitle, content: sharedContent }),
      draftGeneratedAt: new Date(),
      publishedAt: new Date()
    }
  });
  assert.ok(sharedWork.publishedOnceAt, "SHARED 写入必须在数据库层固化首次发布时间");
  targetWorkIds.push(sharedWork.id);

  manualSlug = `${marker}-manual`;
  const manualAnonId = randomUUID();
  const manualWork = await prisma.creativeWork.create({
    data: {
      ownerId: null,
      anonId: manualAnonId,
      genreId: genre.id,
      mode: "MANUAL",
      depth: "SHORT",
      status: "SHARED",
      topic: marker,
      title: `${marker} manual public`,
      summary: "manual moderation probe",
      content: "handwritten public content",
      slug: manualSlug,
      score: 90,
      scoredAt: new Date(),
      scoredHash: "e2e-manual-snapshot",
      publishedAt: new Date()
    }
  });
  targetWorkIds.push(manualWork.id);
  const source = await prisma.writingDoc.create({
    data: {
      ownerId: null,
      anonId: manualAnonId,
      title: manualWork.title,
      content: manualWork.content,
      completedAt: new Date(),
      creativeWorkId: manualWork.id
    }
  });
  manualSourceDocId = source.id;

  const admin = await adminCookie();
  const member = await memberOnlyCookie();

  const anonymousList = await jsonRequest("/api/admin/community-works");
  const memberList = await jsonRequest("/api/admin/community-works", { headers: { cookie: member } });
  assert.equal(anonymousList.response.status, 401);
  assert.equal(memberList.response.status, 401);
  const anonymousAction = await postModeration(sharedWork.id, "UNPUBLISH", "unauthorized probe", "");
  const memberAction = await postModeration(sharedWork.id, "UNPUBLISH", "unauthorized probe", member);
  assert.equal(anonymousAction.response.status, 401);
  assert.equal(memberAction.response.status, 401);
  assert.equal((await prisma.creativeWork.findUniqueOrThrow({ where: { id: sharedWork.id } })).status, "SHARED");
  pass("匿名与普通会员 cookie 均不能读取或调用管理员治理 API");

  const adminList = await jsonRequest("/api/admin/community-works", { headers: { cookie: admin } });
  assert.equal(adminList.response.status, 200, adminList.raw.slice(0, 300));
  assert.equal(adminList.payload.works.some((work) => work.id === privateWork.id), false);
  assert.equal(adminList.payload.works.some((work) => work.id === sharedWork.id), true);
  const privateAction = await postModeration(privateWork.id, "DELETE", "private probe", admin);
  assert.equal(privateAction.response.status, 404, privateAction.raw.slice(0, 300));
  assert.equal((await prisma.creativeWork.findUniqueOrThrow({ where: { id: privateWork.id } })).status, "DRAFT");
  assert.equal(await prisma.communityModerationLog.count({ where: { targetWorkId: privateWork.id } }), 0);
  pass("管理员列表和目标接口都不枚举或治理私有草稿");

  const primedShared = await fetch(`${BASE}/community/${sharedSlug}`, { redirect: "manual" });
  assert.equal(primedShared.status, 200);
  const legacySharedHtml = await primedShared.text();
  assert.doesNotMatch(legacySharedHtml, new RegExp(sharedSummary));
  assert.equal(includesRenderedScore(legacySharedHtml, 88), false);
  const legacyListHtml = await (await fetch(`${BASE}/community`, { redirect: "manual" })).text();
  assert.match(legacyListHtml, new RegExp(sharedTitle));
  assert.doesNotMatch(legacyListHtml, new RegExp(sharedSummary));
  pass("旧 V1 评分公开作品不会展示未经评分的摘要或冒充当前标尺分数");
  const unpublish = await postModeration(sharedWork.id, "UNPUBLISH", "匿名公开内容违反社区规范", admin);
  assert.equal(unpublish.response.status, 200, unpublish.raw.slice(0, 300));
  const unpublishedDb = await prisma.creativeWork.findUniqueOrThrow({ where: { id: sharedWork.id } });
  assert.equal(unpublishedDb.status, "DRAFT");
  assert.equal(unpublishedDb.slug, null);
  assert.equal(unpublishedDb.score, null);
  assert.equal(
    unpublishedDb.publishedOnceAt?.toISOString(),
    sharedWork.publishedOnceAt?.toISOString(),
    "管理员下架不得清除或改写首次发布事实"
  );
  const firstHistory = await prisma.communityModeratedSurface.findMany({
    where: { workId: sharedWork.id }
  });
  assert.equal(firstHistory.length, 1);
  assert.equal(firstHistory[0].algorithm, "TITLE_SUMMARY_CONTENT_V2");
  assert.equal(firstHistory[0].surfaceHash, workScoreFingerprint(sharedWork));
  assert.equal(firstHistory[0].reason, "匿名公开内容违反社区规范");
  await assertPublicSlugGone(`/community/${sharedSlug}`, [sharedTitle, sharedSummary, sharedContent]);
  const unpublishAudit = await prisma.communityModerationLog.findFirst({
    where: { targetWorkId: sharedWork.id, action: "UNPUBLISH" }
  });
  assert.ok(unpublishAudit);
  assert.equal(unpublishAudit.wasAnonymous, true);
  assert.equal(unpublishAudit.slugSnapshot, sharedSlug);
  assert.equal(unpublishAudit.summarySnapshot, sharedWork.summary);
  pass("管理员可下架匿名公开作品，旧 slug 立即失效且审计快照持久化");

  const sharedOwner = cookieHeaderForAuthValue("anonymousIdentity", sharedWork.anonId);
  const deleteAfterUnpublish = await jsonRequest(`/api/public/creation/works/${sharedWork.id}`, {
    method: "DELETE",
    headers: { "content-type": "application/json", cookie: sharedOwner },
    body: JSON.stringify({ expectedUpdatedAt: unpublishedDb.updatedAt.toISOString() })
  });
  assert.equal(deleteAfterUnpublish.response.status, 403, deleteAfterUnpublish.raw.slice(0, 300));
  assert.match(deleteAfterUnpublish.payload.error || "", /曾公开发布|下架不会恢复删除权/);
  assert.ok(await prisma.creativeWork.findUnique({ where: { id: sharedWork.id } }));
  const ownerListAfterUnpublish = await jsonRequest("/api/public/creation/works", {
    headers: { cookie: sharedOwner }
  });
  assert.equal(ownerListAfterUnpublish.response.status, 200, ownerListAfterUnpublish.raw.slice(0, 300));
  const ownerListItem = ownerListAfterUnpublish.payload.works.find((work) => work.id === sharedWork.id);
  assert.equal(ownerListItem?.status, "DRAFT");
  assert.equal(ownerListItem?.canDelete, false, "账户页不得把曾发布后下架的匿名作品显示为可删除");
  pass("匿名作品曾发布后即使被管理员下架，所有者 DELETE 仍返回 403 且作品保留");

  const ownerView = await jsonRequest(`/api/public/creation/works/${sharedWork.id}`, {
    headers: { cookie: sharedOwner }
  });
  assert.equal(ownerView.response.status, 200, ownerView.raw.slice(0, 300));
  assert.equal(ownerView.payload.work.moderationReason, "匿名公开内容违反社区规范");
  assert.equal(ownerView.payload.work.moderationBlocked, true);

  const blockedScore = await jsonRequest(`/api/public/creation/works/${sharedWork.id}/score`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sharedOwner },
    body: JSON.stringify({ expectedUpdatedAt: ownerView.payload.work.updatedAt })
  });
  assert.equal(blockedScore.response.status, 409, blockedScore.raw.slice(0, 300));
  assert.match(blockedScore.payload.error || "", /匿名公开内容违反社区规范/);

  const blockedScoredDb = await prisma.creativeWork.update({
    where: { id: sharedWork.id },
    data: {
      score: 90,
      scoredAt: new Date(),
      scoredHash: workScoreFingerprint(sharedWork),
      scoredRubricHash: workRubricFingerprint({ depth: sharedWork.depth, genre })
    }
  });
  const blockedPublish = await jsonRequest(`/api/public/creation/works/${sharedWork.id}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sharedOwner },
    body: JSON.stringify({
      confirmAnonymousNoDelete: true,
      expectedUpdatedAt: blockedScoredDb.updatedAt.toISOString()
    })
  });
  assert.equal(blockedPublish.response.status, 409, blockedPublish.raw.slice(0, 300));
  pass("被下架的原版本在评分和发布两条入口都返回 409，并向所有者显示治理原因");

  const beforeRevision = await prisma.creativeWork.findUniqueOrThrow({ where: { id: sharedWork.id } });
  const revisedSummary = `${sharedWork.summary}（已整改）`;
  const revisedContent = `${sharedWork.content}\n\n已按治理要求补充公开依据。`;
  const revise = await jsonRequest(`/api/public/creation/works/${sharedWork.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: sharedOwner },
    body: JSON.stringify({
      summary: revisedSummary,
      content: revisedContent,
      expectedUpdatedAt: beforeRevision.updatedAt.toISOString()
    })
  });
  assert.equal(revise.response.status, 200, revise.raw.slice(0, 300));
  assert.equal(revise.payload.work.moderationBlocked, false);
  const revisedDb = await prisma.creativeWork.findUniqueOrThrow({ where: { id: sharedWork.id } });
  assert.equal(
    await prisma.communityModeratedSurface.count({ where: { workId: sharedWork.id } }),
    1,
    "首次修改不能清除或覆盖治理历史"
  );

  const restoreOriginal = await jsonRequest(`/api/public/creation/works/${sharedWork.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: sharedOwner },
    body: JSON.stringify({
      title: sharedWork.title,
      summary: sharedWork.summary,
      content: sharedWork.content,
      expectedUpdatedAt: revisedDb.updatedAt.toISOString()
    })
  });
  assert.equal(restoreOriginal.response.status, 200, restoreOriginal.raw.slice(0, 300));
  assert.equal(restoreOriginal.payload.work.moderationBlocked, true);
  const restoredScore = await jsonRequest(`/api/public/creation/works/${sharedWork.id}/score`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sharedOwner },
    body: JSON.stringify({ expectedUpdatedAt: restoreOriginal.payload.work.updatedAt })
  });
  assert.equal(restoredScore.response.status, 409, restoredScore.raw.slice(0, 300));
  pass("先修改再恢复被下架原文仍会命中持久治理指纹");

  const reviseAgain = await jsonRequest(`/api/public/creation/works/${sharedWork.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: sharedOwner },
    body: JSON.stringify({
      summary: revisedSummary,
      content: revisedContent,
      expectedUpdatedAt: restoreOriginal.payload.work.updatedAt
    })
  });
  assert.equal(reviseAgain.response.status, 200, reviseAgain.raw.slice(0, 300));
  assert.equal(reviseAgain.payload.work.moderationBlocked, false);
  const revisedAgainDb = await prisma.creativeWork.findUniqueOrThrow({ where: { id: sharedWork.id } });
  const staleRubricScoredDb = await prisma.creativeWork.update({
    where: { id: sharedWork.id },
    data: {
      score: 91,
      scoredAt: new Date(),
      scoredHash: workScoreFingerprint({
        title: revisedAgainDb.title,
        summary: revisedAgainDb.summary,
        content: revisedAgainDb.content
      }),
      scoredRubricHash: "stale-rubric-snapshot"
    }
  });
  const staleRubricPublish = await jsonRequest(`/api/public/creation/works/${sharedWork.id}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sharedOwner },
    body: JSON.stringify({
      confirmAnonymousNoDelete: true,
      expectedUpdatedAt: staleRubricScoredDb.updatedAt.toISOString()
    })
  });
  assert.equal(staleRubricPublish.response.status, 409, staleRubricPublish.raw.slice(0, 300));
  assert.match(staleRubricPublish.payload.error || "", /评分标尺|重新评分/);
  pass("旧题材标尺下的分数不能用于发布");

  const revisedScoredDb = await prisma.creativeWork.update({
    where: { id: sharedWork.id },
    data: {
      score: 91,
      scoredAt: new Date(),
      scoredHash: workScoreFingerprint({
        title: revisedAgainDb.title,
        summary: revisedAgainDb.summary,
        content: revisedAgainDb.content
      }),
      scoredRubricHash: workRubricFingerprint({ depth: revisedAgainDb.depth, genre })
    }
  });
  const revisedPublish = await jsonRequest(`/api/public/creation/works/${sharedWork.id}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sharedOwner },
    body: JSON.stringify({
      confirmAnonymousNoDelete: true,
      expectedUpdatedAt: revisedScoredDb.updatedAt.toISOString()
    })
  });
  assert.equal(revisedPublish.response.status, 200, revisedPublish.raw.slice(0, 300));
  const revisedPublicHtml = await (
    await fetch(`${BASE}${revisedPublish.payload.url}`, { redirect: "manual" })
  ).text();
  assert.match(revisedPublicHtml, new RegExp(revisedSummary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(includesRenderedScore(revisedPublicHtml, 91), true);
  pass("公开表面实质修改并重新评分后可以重新发布");

  const secondReason = "B 版本第二次下架原因";
  const secondUnpublish = await postModeration(
    sharedWork.id,
    "UNPUBLISH",
    secondReason,
    admin
  );
  assert.equal(secondUnpublish.response.status, 200, secondUnpublish.raw.slice(0, 300));
  const secondUnpublishedDb = await prisma.creativeWork.findUniqueOrThrow({ where: { id: sharedWork.id } });
  assert.equal(
    secondUnpublishedDb.publishedOnceAt?.toISOString(),
    sharedWork.publishedOnceAt?.toISOString(),
    "反复发布和下架也不得重写首次发布时间"
  );
  const allHistory = await prisma.communityModeratedSurface.findMany({
    where: { workId: sharedWork.id },
    orderBy: { createdAt: "asc" }
  });
  assert.equal(allHistory.length, 2, "A、B 两个治理版本都必须保留");
  const byHash = new Map(allHistory.map((surface) => [surface.surfaceHash, surface]));
  assert.equal(byHash.get(workScoreFingerprint(sharedWork))?.reason, "匿名公开内容违反社区规范");
  assert.equal(byHash.get(workScoreFingerprint({
    title: revisedAgainDb.title,
    summary: revisedAgainDb.summary,
    content: revisedAgainDb.content
  }))?.reason, secondReason);
  pass("再次下架会追加 B 版本，不覆盖 A 版本治理历史");

  const restoreAAfterB = await jsonRequest(`/api/public/creation/works/${sharedWork.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: sharedOwner },
    body: JSON.stringify({
      title: sharedWork.title,
      summary: sharedWork.summary,
      content: sharedWork.content,
      expectedUpdatedAt: secondUnpublishedDb.updatedAt.toISOString()
    })
  });
  assert.equal(restoreAAfterB.response.status, 200, restoreAAfterB.raw.slice(0, 300));
  assert.equal(restoreAAfterB.payload.work.moderationBlocked, true);
  assert.equal(restoreAAfterB.payload.work.moderationReason, "匿名公开内容违反社区规范");
  assert.doesNotMatch(restoreAAfterB.raw, new RegExp(secondReason), "owner 响应不能泄露未命中的 B 原因");

  const scoreRestoredA = await jsonRequest(`/api/public/creation/works/${sharedWork.id}/score`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sharedOwner },
    body: JSON.stringify({ expectedUpdatedAt: restoreAAfterB.payload.work.updatedAt })
  });
  assert.equal(scoreRestoredA.response.status, 409, scoreRestoredA.raw.slice(0, 300));
  assert.match(scoreRestoredA.payload.error || "", /匿名公开内容违反社区规范/);
  assert.doesNotMatch(scoreRestoredA.raw, new RegExp(secondReason));

  const restoredADb = await prisma.creativeWork.findUniqueOrThrow({ where: { id: sharedWork.id } });
  const scoredRestoredA = await prisma.creativeWork.update({
    where: { id: sharedWork.id },
    data: {
      score: 92,
      scoredAt: new Date(),
      scoredHash: workScoreFingerprint(restoredADb),
      scoredRubricHash: workRubricFingerprint({ depth: restoredADb.depth, genre })
    }
  });
  const publishRestoredA = await jsonRequest(`/api/public/creation/works/${sharedWork.id}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sharedOwner },
    body: JSON.stringify({
      confirmAnonymousNoDelete: true,
      expectedUpdatedAt: scoredRestoredA.updatedAt.toISOString()
    })
  });
  assert.equal(publishRestoredA.response.status, 409, publishRestoredA.raw.slice(0, 300));
  assert.match(publishRestoredA.payload.error || "", /匿名公开内容违反社区规范/);
  pass("A→B 两轮下架后恢复 A，owner/score/publish 仍命中 A 且不泄露 B 原因");

  const primedManual = await fetch(`${BASE}/community/${manualSlug}`, { redirect: "manual" });
  assert.equal(primedManual.status, 200);
  const removeManual = await postModeration(manualWork.id, "DELETE", "手写作品确认严重违规", admin);
  assert.equal(removeManual.response.status, 200, removeManual.raw.slice(0, 300));
  assert.equal(await prisma.creativeWork.findUnique({ where: { id: manualWork.id } }), null);
  const retainedSource = await prisma.writingDoc.findUniqueOrThrow({ where: { id: source.id } });
  assert.equal(retainedSource.creativeWorkId, null);
  assert.ok(retainedSource.publicationBlockedAt, "私有手写原稿必须保留并写入社区交接锁");
  await assertPublicSlugGone(`/community/${manualSlug}`, [manualWork.title, manualWork.summary, manualWork.content]);
  const deleteAudit = await prisma.communityModerationLog.findFirst({
    where: { targetWorkId: manualWork.id, action: "DELETE" }
  });
  assert.ok(deleteAudit, "作品删除后审计日志仍必须存在");
  assert.equal(deleteAudit.titleSnapshot, manualWork.title);
  assert.equal(deleteAudit.slugSnapshot, manualSlug);
  pass("永久删除 MANUAL 公开副本后旧 slug 消失、私有原稿保留且审计不丢失");

  const manualOwner = cookieHeaderForAuthValue("anonymousIdentity", manualAnonId);
  const sourceRead = await jsonRequest(`/api/public/writing/docs/${source.id}`, {
    headers: { cookie: manualOwner }
  });
  assert.equal(sourceRead.response.status, 200, sourceRead.raw.slice(0, 300));
  assert.equal(sourceRead.payload.doc.content, manualWork.content);
  assert.ok(sourceRead.payload.doc.publicationBlockedAt);

  const sourceEdit = await jsonRequest(`/api/public/writing/docs/${source.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: manualOwner },
    body: JSON.stringify({
      title: `${manualWork.title}（私有保留）`,
      expectedUpdatedAt: sourceRead.payload.doc.updatedAt
    })
  });
  assert.equal(sourceEdit.response.status, 200, sourceEdit.raw.slice(0, 300));
  assert.ok(sourceEdit.payload.doc.publicationBlockedAt, "编辑私有原稿不能清除交接锁");

  const repeatHandoff = await jsonRequest(`/api/public/writing/docs/${source.id}/community-draft`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: manualOwner },
    body: JSON.stringify({
      genreId: genre.id,
      depth: "SHORT",
      expectedUpdatedAt: sourceEdit.payload.doc.updatedAt
    })
  });
  assert.equal(repeatHandoff.response.status, 409, repeatHandoff.raw.slice(0, 300));
  assert.match(repeatHandoff.payload.error || "", /社区交接.*锁定/);
  pass("治理后的私有手稿仍可读取和编辑，但重复社区交接返回 409");

  console.log(`\nAll ${checks} community moderation HTTP/DB checks passed.`);
} finally {
  if (manualSourceDocId) {
    await prisma.writingDoc.deleteMany({ where: { id: manualSourceDocId } }).catch(() => undefined);
  }
  await prisma.creativeWork.deleteMany({ where: { id: { in: targetWorkIds } } }).catch(() => undefined);
  await prisma.communityModerationLog.deleteMany({ where: { targetWorkId: { in: targetWorkIds } } }).catch(() => undefined);
  await prisma.$disconnect();
}
