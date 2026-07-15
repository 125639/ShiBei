/**
 * 作品所有权的真实 HTTP + 数据库安全回归：
 *   - 登录/注册绝不自动认领匿名作品或文档；
 *   - 同一请求同时带会员与匿名 cookie 时，只认会员身份；
 *   - 第二个会员不能借匿名 cookie 抢占、读取或修改内容；
 *   - 未授权作品请求不消耗 AI 配额；
 *   - 数据库拒绝双重身份与无身份记录。
 *
 * 用法：BASE_URL=http://127.0.0.1:3100 node scripts/e2e/verify-ownership-security.mjs
 * DATABASE_URL / AUTH_SECRET 必须与被测应用一致。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  LEGACY_AUTH_COOKIE_NAMES,
  authCookieFrom,
  authCookieValue,
  cookieHeaderForAuthValue
} from "./auth-cookie-names.mjs";

const require = createRequire(import.meta.url);
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const prisma = new PrismaClient();
const marker = `ownership-security-${Date.now()}-${randomUUID().slice(0, 8)}`;
const victimAnon = randomUUID();
const otherAnon = randomUUID();
const password = `Safe-${randomUUID()}`;
const inviteCode = `SB-${randomAlphabet(4)}-${randomAlphabet(4)}`;
const createdMemberIds = [];
let checks = 0;

function pass(label) {
  checks += 1;
  console.log(`PASS  ${label}`);
}

function randomAlphabet(length) {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function headersWithCookies(memberCookie, anonId = victimAnon, extra = {}) {
  return {
    ...extra,
    cookie: [
      memberCookie,
      anonId ? cookieHeaderForAuthValue("anonymousIdentity", anonId) : ""
    ].filter(Boolean).join("; ")
  };
}

async function jsonRequest(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, init);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function login(email, anonId = victimAnon) {
  const result = await jsonRequest("/api/member/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${20 + createdMemberIds.length}`,
      ...(anonId ? { cookie: cookieHeaderForAuthValue("anonymousIdentity", anonId) } : {})
    },
    body: JSON.stringify({ account: email, secret: password })
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal("claimedWorks" in result.payload, false, "login response must not expose obsolete claim results");
  return { ...result, memberCookie: authCookieFrom(result.response, "memberSession") };
}

let anonWork;
let memberWork;
let anonDoc;
let memberDoc;

try {
  const genre = await prisma.creationGenre.findFirst({ where: { isEnabled: true } });
  assert.ok(genre, "an enabled creation genre is required");

  const passwordHash = await bcrypt.hash(password, 4);
  const memberA = await prisma.memberUser.create({
    data: { email: `${marker}-a@example.test`, passwordHash }
  });
  const memberB = await prisma.memberUser.create({
    data: { email: `${marker}-b@example.test`, passwordHash }
  });
  createdMemberIds.push(memberA.id, memberB.id);

  anonWork = await prisma.creativeWork.create({
    data: {
      ownerId: null,
      anonId: victimAnon,
      genreId: genre.id,
      mode: "VOICE_FIRST",
      depth: "SHORT",
      status: "DRAFT",
      topic: marker,
      title: "anonymous private work",
      content: "victim private content",
      draftGeneratedAt: new Date()
    }
  });
  memberWork = await prisma.creativeWork.create({
    data: {
      ownerId: memberA.id,
      anonId: null,
      genreId: genre.id,
      mode: "VOICE_FIRST",
      depth: "SHORT",
      status: "DRAFT",
      topic: marker,
      title: "member A work",
      content: "member A content",
      draftGeneratedAt: new Date()
    }
  });
  anonDoc = await prisma.writingDoc.create({
    data: { ownerId: null, anonId: victimAnon, title: marker, content: "anonymous doc" }
  });
  memberDoc = await prisma.writingDoc.create({
    data: { ownerId: memberA.id, anonId: null, title: marker, content: "member A doc" }
  });

  const legacyAnonOnly = await fetch(`${BASE}/api/public/creation/works/${anonWork.id}`, {
    headers: { cookie: `${LEGACY_AUTH_COOKIE_NAMES.anonymousIdentity}=${victimAnon}` }
  });
  const legacyVictimBeforeOtherActive = await fetch(
    `${BASE}/api/public/creation/works/${anonWork.id}`,
    {
      headers: {
        cookie: `${LEGACY_AUTH_COOKIE_NAMES.anonymousIdentity}=${victimAnon}; ${cookieHeaderForAuthValue("anonymousIdentity", otherAnon)}`
      }
    }
  );
  const legacyOtherBeforeVictimActive = await fetch(
    `${BASE}/api/public/creation/works/${anonWork.id}`,
    {
      headers: {
        cookie: `${LEGACY_AUTH_COOKIE_NAMES.anonymousIdentity}=${otherAnon}; ${cookieHeaderForAuthValue("anonymousIdentity", victimAnon)}`
      }
    }
  );
  assert.equal(legacyAnonOnly.status, 404);
  assert.equal(legacyVictimBeforeOtherActive.status, 404);
  assert.equal(legacyOtherBeforeVictimActive.status, 200);
  pass("旧版无前缀匿名 Cookie 无法单独冒充身份，也无法通过排序覆盖当前主机身份");

  // 登录请求携带匿名 cookie 也不得产生任何所有权迁移。
  const loginA = await login(memberA.email);
  const afterLoginA = await prisma.creativeWork.findUniqueOrThrow({ where: { id: anonWork.id } });
  const docAfterLoginA = await prisma.writingDoc.findUniqueOrThrow({ where: { id: anonDoc.id } });
  assert.equal(afterLoginA.ownerId, null);
  assert.equal(afterLoginA.anonId, victimAnon);
  assert.equal(docAfterLoginA.ownerId, null);
  assert.equal(docAfterLoginA.anonId, victimAnon);
  pass("会员登录不会认领同浏览器匿名作品或文档");

  const validMemberToken = authCookieValue(loginA.memberCookie);
  const legacyMemberOnly = await fetch(`${BASE}/api/public/creation/works/${memberWork.id}`, {
    headers: {
      cookie: `${LEGACY_AUTH_COOKIE_NAMES.memberSession}=${validMemberToken}`
    }
  });
  const poisonedLegacyBeforeMember = await fetch(
    `${BASE}/api/public/creation/works/${memberWork.id}`,
    {
      headers: {
        cookie: `${LEGACY_AUTH_COOKIE_NAMES.memberSession}=poisoned-first; ${loginA.memberCookie}`
      }
    }
  );
  assert.equal(legacyMemberOnly.status, 404);
  assert.equal(poisonedLegacyBeforeMember.status, 200);
  pass("旧版无前缀会员 Cookie 被彻底忽略，不能覆盖有效会员会话");

  const combinedA = headersWithCookies(loginA.memberCookie);
  const workRead = await fetch(`${BASE}/api/public/creation/works/${anonWork.id}`, { headers: combinedA });
  assert.equal(workRead.status, 404);
  const workPatch = await fetch(`${BASE}/api/public/creation/works/${anonWork.id}`, {
    method: "PATCH",
    headers: headersWithCookies(loginA.memberCookie, victimAnon, { "content-type": "application/json" }),
    body: JSON.stringify({ title: "attacker changed this", expectedUpdatedAt: anonWork.updatedAt.toISOString() })
  });
  assert.equal(workPatch.status, 404);
  const workDelete = await fetch(`${BASE}/api/public/creation/works/${anonWork.id}`, {
    method: "DELETE",
    headers: headersWithCookies(loginA.memberCookie, victimAnon, { "content-type": "application/json" }),
    body: JSON.stringify({ expectedUpdatedAt: anonWork.updatedAt.toISOString() })
  });
  assert.equal(workDelete.status, 404);
  const workExport = await fetch(`${BASE}/api/public/creation/works/${anonWork.id}/export`, { headers: combinedA });
  assert.equal(workExport.status, 404);
  const workPublish = await fetch(`${BASE}/api/public/creation/works/${anonWork.id}/publish`, {
    method: "POST",
    headers: headersWithCookies(loginA.memberCookie, victimAnon, { "content-type": "application/json" }),
    body: JSON.stringify({
      confirmAnonymousNoDelete: true,
      expectedUpdatedAt: anonWork.updatedAt.toISOString()
    })
  });
  assert.equal(workPublish.status, 404);
  pass("直接 API 绕过无法读取、编辑、删除、导出或发布匿名作品");

  const docsRead = await fetch(`${BASE}/api/public/writing/docs/${anonDoc.id}`, { headers: combinedA });
  assert.equal(docsRead.status, 404);
  const docsPatch = await fetch(`${BASE}/api/public/writing/docs/${anonDoc.id}`, {
    method: "PATCH",
    headers: headersWithCookies(loginA.memberCookie, victimAnon, { "content-type": "application/json" }),
    body: JSON.stringify({ content: "attacker changed doc", expectedUpdatedAt: anonDoc.updatedAt.toISOString() })
  });
  assert.equal(docsPatch.status, 404);
  const docsDelete = await fetch(`${BASE}/api/public/writing/docs/${anonDoc.id}`, {
    method: "DELETE",
    headers: headersWithCookies(loginA.memberCookie, victimAnon, { "content-type": "application/json" }),
    body: JSON.stringify({ expectedUpdatedAt: anonDoc.updatedAt.toISOString() })
  });
  assert.equal(docsDelete.status, 404);
  const docsComplete = await fetch(`${BASE}/api/public/writing/docs/${anonDoc.id}/complete`, {
    method: "POST",
    headers: combinedA
  });
  assert.equal(docsComplete.status, 404);
  const docsHandoff = await fetch(`${BASE}/api/public/writing/docs/${anonDoc.id}/community-draft`, {
    method: "POST",
    headers: headersWithCookies(loginA.memberCookie, victimAnon, { "content-type": "application/json" }),
    body: JSON.stringify({
      genreId: genre.id,
      depth: "SHORT",
      expectedUpdatedAt: anonDoc.updatedAt.toISOString()
    })
  });
  assert.equal(docsHandoff.status, 404);
  assert.equal(
    (await prisma.writingDoc.findUniqueOrThrow({ where: { id: anonDoc.id } })).creativeWorkId,
    null
  );
  pass("直接 API 绕过无法读取、编辑、删除、完成或绑定匿名写作文档");

  const memberWorks = await jsonRequest("/api/public/creation/works", { headers: combinedA });
  assert.equal(memberWorks.response.status, 200);
  assert.deepEqual(memberWorks.payload.works.map((work) => work.id), [memberWork.id]);
  const memberDocs = await jsonRequest("/api/public/writing/docs", { headers: combinedA });
  assert.equal(memberDocs.response.status, 200);
  assert.deepEqual(memberDocs.payload.docs.map((doc) => doc.id), [memberDoc.id]);
  pass("登录态列表只返回 memberId 内容，不混入同浏览器匿名内容");

  // 授权检查必须发生在 AI 限流之前：旧实现第 13 次会从 404 变成 429。
  const quotaProbeIp = `203.0.113.${Math.floor(Math.random() * 180 + 20)}`;
  for (let index = 0; index < 14; index += 1) {
    const response = await fetch(`${BASE}/api/public/creation/works/${anonWork.id}/score`, {
      method: "POST",
      headers: headersWithCookies(loginA.memberCookie, victimAnon, {
        "content-type": "application/json",
        "x-forwarded-for": quotaProbeIp
      }),
      body: JSON.stringify({ expectedUpdatedAt: anonWork.updatedAt.toISOString() })
    });
    assert.equal(response.status, 404, `unauthorized score attempt ${index + 1} returned ${response.status}`);
  }
  const answer = await fetch(`${BASE}/api/public/creation/works/${anonWork.id}/answer`, {
    method: "POST",
    headers: headersWithCookies(loginA.memberCookie, victimAnon, { "content-type": "application/json" }),
    body: JSON.stringify({ answer: "unauthorized", expectedUpdatedAt: anonWork.updatedAt.toISOString() })
  });
  const compose = await fetch(`${BASE}/api/public/creation/works/${anonWork.id}/compose`, {
    method: "POST",
    headers: headersWithCookies(loginA.memberCookie, victimAnon, { "content-type": "application/json" }),
    body: JSON.stringify({ expectedUpdatedAt: anonWork.updatedAt.toISOString() })
  });
  assert.equal(answer.status, 404);
  assert.equal(compose.status, 404);
  pass("未授权的评分、回答与成稿请求不消耗 AI 配额");

  // 第二个现有账号携带同一匿名 cookie，仍不能认领或操作。
  const loginB = await login(memberB.email);
  const secondRead = await fetch(`${BASE}/api/public/creation/works/${anonWork.id}`, {
    headers: headersWithCookies(loginB.memberCookie)
  });
  const secondPatch = await fetch(`${BASE}/api/public/creation/works/${anonWork.id}`, {
    method: "PATCH",
    headers: headersWithCookies(loginB.memberCookie, victimAnon, { "content-type": "application/json" }),
    body: JSON.stringify({ title: "second user takeover", expectedUpdatedAt: anonWork.updatedAt.toISOString() })
  });
  assert.equal(secondRead.status, 404);
  assert.equal(secondPatch.status, 404);
  assert.equal((await prisma.creativeWork.findUniqueOrThrow({ where: { id: anonWork.id } })).ownerId, null);
  pass("第二个登录用户无法抢占同一匿名作品");

  // 未显式开启 feature flag 时，旧邮箱注册旁路必须关闭。
  const emailRegister = await jsonRequest("/api/member/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.71",
      cookie: cookieHeaderForAuthValue("anonymousIdentity", victimAnon)
    },
    body: JSON.stringify({ email: `${marker}-register@example.test`, password, displayName: "security test" })
  });
  assert.equal(emailRegister.response.status, 404, JSON.stringify(emailRegister.payload));

  // 正常的邀请码开户同样不能隐式迁移匿名内容。
  await prisma.inviteCode.create({ data: { code: inviteCode, note: marker } });
  const inviteRegister = await jsonRequest("/api/member/register-invite", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.72",
      cookie: cookieHeaderForAuthValue("anonymousIdentity", victimAnon)
    },
    body: JSON.stringify({ username: `${marker.slice(-8)}-invite`, code: inviteCode, password })
  });
  assert.equal(inviteRegister.response.status, 200, JSON.stringify(inviteRegister.payload));
  assert.equal("claimedWorks" in inviteRegister.payload, false);
  createdMemberIds.push(inviteRegister.payload.member.id);

  const afterRegistrations = await prisma.creativeWork.findUniqueOrThrow({ where: { id: anonWork.id } });
  const docAfterRegistrations = await prisma.writingDoc.findUniqueOrThrow({ where: { id: anonDoc.id } });
  assert.equal(afterRegistrations.ownerId, null);
  assert.equal(afterRegistrations.anonId, victimAnon);
  assert.equal(docAfterRegistrations.ownerId, null);
  assert.equal(docAfterRegistrations.anonId, victimAnon);
  pass("开放邮箱注册旁路被拒，邀请码开户不会自动认领匿名内容");

  // 匿名身份本身仍然有效；另一个匿名 token 不可访问。退出账号不会删除 anon cookie。
  const logout = await fetch(`${BASE}/api/member/logout`, {
    method: "POST",
    headers: combinedA
  });
  assert.equal(logout.status, 200);
  const anonRead = await fetch(`${BASE}/api/public/creation/works/${anonWork.id}`, {
    headers: { cookie: cookieHeaderForAuthValue("anonymousIdentity", victimAnon) }
  });
  const otherAnonRead = await fetch(`${BASE}/api/public/creation/works/${anonWork.id}`, {
    headers: { cookie: cookieHeaderForAuthValue("anonymousIdentity", otherAnon) }
  });
  assert.equal(anonRead.status, 200);
  assert.equal(otherAnonRead.status, 404);
  const anonDocPatch = await fetch(`${BASE}/api/public/writing/docs/${anonDoc.id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeaderForAuthValue("anonymousIdentity", victimAnon)
    },
    body: JSON.stringify({
      content: "anonymous owner update",
      expectedUpdatedAt: anonDoc.updatedAt.toISOString()
    })
  });
  assert.equal(anonDocPatch.status, 200);
  pass("退出登录后原匿名 cookie 仍可访问自己的内容，其他匿名 token 不可访问");

  // 数据库是最后一道边界：以后即使应用代码回归，也不能写出双重身份或无主记录。
  await assert.rejects(() => prisma.creativeWork.create({
    data: {
      ownerId: memberA.id,
      anonId: victimAnon,
      genreId: genre.id,
      mode: "VOICE_FIRST",
      depth: "SHORT",
      topic: `${marker}-invalid-dual`
    }
  }));
  await assert.rejects(() => prisma.creativeWork.create({
    data: {
      ownerId: null,
      anonId: null,
      genreId: genre.id,
      mode: "VOICE_FIRST",
      depth: "SHORT",
      topic: `${marker}-invalid-none`
    }
  }));
  await assert.rejects(() => prisma.writingDoc.create({
    data: { ownerId: memberA.id, anonId: victimAnon, title: `${marker}-invalid-dual` }
  }));
  await assert.rejects(() => prisma.writingDoc.create({
    data: { ownerId: null, anonId: null, title: `${marker}-invalid-none` }
  }));
  pass("数据库约束拒绝双重身份和无身份记录");

  const finalWork = await prisma.creativeWork.findUniqueOrThrow({ where: { id: anonWork.id } });
  assert.equal(finalWork.ownerId, null);
  assert.equal(finalWork.anonId, victimAnon);
  assert.notEqual(finalWork.title, "attacker changed this");
  assert.notEqual(finalWork.title, "second user takeover");
  pass("所有攻击尝试后匿名作品所有权与内容保持不变");

  console.log(`\nAll ${checks} ownership security checks passed.`);
} finally {
  await prisma.writingDoc.deleteMany({ where: { title: { startsWith: marker } } }).catch(() => undefined);
  await prisma.creativeWork.deleteMany({ where: { topic: { startsWith: marker } } }).catch(() => undefined);
  await prisma.inviteCode.deleteMany({ where: { OR: [{ code: inviteCode }, { note: marker }] } }).catch(() => undefined);
  if (createdMemberIds.length > 0) {
    await prisma.memberUser.deleteMany({ where: { id: { in: createdMemberIds } } }).catch(() => undefined);
  }
  await prisma.memberUser.deleteMany({
    where: { OR: [{ email: { startsWith: marker } }, { username: { startsWith: marker.slice(-8) } }] }
  }).catch(() => undefined);
  await prisma.$disconnect();
}
