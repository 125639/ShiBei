/**
 * 会员认证安全的真实 HTTP + 数据库回归：
 *   - 默认关闭未在 UI 暴露的开放邮箱注册；
 *   - 邀请码只开户一次，新会员用自设密码登录；
 *   - USED / REVOKED 邀请码在管理员 API 与数据库中均被遮盖；
 *   - 历史邀请码只能换取短时、用途和路径受限的改密凭据；
 *   - 登出、改密都会用 tokenVersion 吊销旧 JWT。
 *
 * 用法：BASE_URL=http://127.0.0.1:3100 node scripts/e2e/verify-member-auth-security.mjs
 * DATABASE_URL / AUTH_SECRET 必须与被测应用一致。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { SignJWT } from "jose";
import {
  AUTH_COOKIE_NAMES,
  LEGACY_AUTH_COOKIE_NAMES,
  authCookieFrom,
  authCookieValue,
  cookieHeaderForAuthValue,
  setCookieValues
} from "./auth-cookie-names.mjs";

try {
  if (typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
} catch {
  // 调用方显式提供环境变量时无需读取本地文件。
}

const require = createRequire(import.meta.url);
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const prisma = new PrismaClient();
const marker = `member-auth-security-${Date.now()}-${randomUUID().slice(0, 8)}`;
const newUsername = `new_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const legacyUsername = `old_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const newPassword = `Nw!7-${randomUUID()}`;
const changedPassword = `Ch!8-${randomUUID()}`;
const legacyPassword = `Lg!9-${randomUUID()}`;
const legacyCode = randomInviteCode();
const signupCode = randomInviteCode();
const revokeCode = randomInviteCode();
const raceCode = randomInviteCode();
const raceUsername = `race_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const racePassword = `Rc!6-${randomUUID()}`;
const memberIds = [];
const inviteIds = [];
let checks = 0;

function pass(label) {
  checks += 1;
  console.log(`PASS  ${label}`);
}

function randomInviteCode() {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const block = () => Array.from(
    { length: 4 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)]
  ).join("");
  return `SB-${block()}-${block()}`;
}

function assertAuthCookieAttributes(response, kind, pair) {
  const name = pair.slice(0, pair.indexOf("="));
  assert.ok(AUTH_COOKIE_NAMES[kind].includes(name), `unexpected ${kind} cookie name: ${name}`);
  const header = setCookieValues(response).find((value) => value.includes(`${name}=`)) || "";
  assert.ok(header, `missing Set-Cookie attributes for ${name}`);
  assert.doesNotMatch(header, /;\s*Domain=/i, `${name} must remain host-only`);
  assert.match(header, /;\s*HttpOnly(?:;|$)/i);

  if (name.startsWith("__Host-")) {
    assert.match(header, /;\s*Secure(?:;|$)/i);
    assert.match(header, /;\s*Path=\/(?:;|$)/i);
  } else if (kind === "memberCredentialUpgrade") {
    assert.match(header, /;\s*Path=\/api\/member\/upgrade-credential(?:;|$)/i);
  } else {
    assert.match(header, /;\s*Path=\/(?:;|$)/i);
  }
}

async function jsonRequest(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  return { response, payload, raw: text };
}

function postJson(path, body, { cookie, ip = "198.51.100.140" } = {}) {
  return jsonRequest(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(body)
  });
}

async function login(account, secret, ip) {
  return postJson("/api/member/login", { account, secret }, { ip });
}

async function makeAdminCookie() {
  const admin = await prisma.adminUser.findFirst({ select: { id: true, tokenVersion: true } });
  assert.ok(admin, "an administrator is required for the admin API check");
  const configured = process.env.AUTH_SECRET;
  const rawSecret = configured || "dev-auth-secret-change-me";
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be provided when verifying a production server");
  }
  const token = await new SignJWT({ userId: admin.id, ver: admin.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(rawSecret));
  return cookieHeaderForAuthValue("adminSession", token);
}

async function assertLoggedOut(cookie, privateWorkId) {
  const me = await jsonRequest("/api/member/me", { headers: { cookie } });
  assert.equal(me.response.status, 200);
  assert.equal(me.payload.member, null);
  const works = await jsonRequest("/api/public/creation/works", { headers: { cookie } });
  assert.equal(works.response.status, 200);
  assert.equal(works.payload.works.some((work) => work.id === privateWorkId), false);
}

let signupWorkId;
let legacyWorkId;

try {
  const genre = await prisma.creationGenre.findFirst({ where: { isEnabled: true } });
  assert.ok(genre, "an enabled creation genre is required");

  const publicRegister = await postJson(
    "/api/member/register",
    {
      email: `${randomUUID()}@example.test`,
      password: newPassword,
      displayName: "bypass probe"
    },
    { ip: "198.51.100.141" }
  );
  assert.equal(publicRegister.response.status, 404, JSON.stringify(publicRegister.payload));
  assert.match(String(publicRegister.payload.error || ""), /邀请码/);
  pass("默认关闭未在 UI 暴露的开放邮箱注册旁路");

  const signupInvite = await prisma.inviteCode.create({
    data: { code: signupCode, note: marker }
  });
  inviteIds.push(signupInvite.id);

  const signup = await postJson(
    "/api/member/register-invite",
    { username: newUsername, code: signupCode, password: newPassword },
    { ip: "198.51.100.142" }
  );
  assert.equal(signup.response.status, 200, JSON.stringify(signup.payload));
  const signupCookie = authCookieFrom(signup.response, "memberSession");
  assertAuthCookieAttributes(signup.response, "memberSession", signupCookie);
  const signupMemberId = signup.payload.member.id;
  memberIds.push(signupMemberId);

  const createdMember = await prisma.memberUser.findUniqueOrThrow({ where: { id: signupMemberId } });
  const consumedInvite = await prisma.inviteCode.findUniqueOrThrow({ where: { id: signupInvite.id } });
  assert.equal(createdMember.credentialState, "ACTIVE");
  assert.equal(await bcrypt.compare(newPassword, createdMember.passwordHash), true);
  assert.equal(await bcrypt.compare(signupCode, createdMember.passwordHash), false);
  assert.equal(consumedInvite.status, "USED");
  assert.equal(consumedInvite.code, `__RETIRED_USED_${signupInvite.id}`);

  const codeLogin = await login(newUsername, signupCode, "198.51.100.143");
  assert.equal(codeLogin.response.status, 401);
  const passwordLogin = await login(newUsername, newPassword, "198.51.100.144");
  assert.equal(passwordLogin.response.status, 200, JSON.stringify(passwordLogin.payload));
  pass("新邀请码会员只能用自设密码登录，邀请码使用后立即失效并从数据库抹除");

  signupWorkId = (await prisma.creativeWork.create({
    data: {
      ownerId: signupMemberId,
      anonId: null,
      genreId: genre.id,
      mode: "VOICE_FIRST",
      depth: "SHORT",
      status: "DRAFT",
      topic: marker,
      title: "new member private work",
      content: "private",
      draftGeneratedAt: new Date()
    }
  })).id;

  const signupWorks = await jsonRequest("/api/public/creation/works", {
    headers: { cookie: signupCookie }
  });
  assert.equal(signupWorks.response.status, 200);
  assert.equal(signupWorks.payload.works.some((work) => work.id === signupWorkId), true);

  const signupToken = authCookieValue(signupCookie);
  await assertLoggedOut(
    `${LEGACY_AUTH_COOKIE_NAMES.memberSession}=${signupToken}`,
    signupWorkId
  );
  const duplicateCookieMe = await jsonRequest("/api/member/me", {
    headers: {
      cookie: `${LEGACY_AUTH_COOKIE_NAMES.memberSession}=poisoned-first; ${signupCookie}`
    }
  });
  assert.equal(duplicateCookieMe.response.status, 200);
  assert.equal(duplicateCookieMe.payload.member?.id, signupMemberId);
  pass("旧版无前缀会员 Cookie 单独使用会被拒绝，与新 Cookie 并存时也不能抢先覆盖身份");

  const adminCookie = await makeAdminCookie();
  const adminCodes = await jsonRequest("/api/admin/invites", {
    headers: { cookie: adminCookie },
    redirect: "manual"
  });
  assert.equal(adminCodes.response.status, 200, adminCodes.raw.slice(0, 300));
  const usedView = adminCodes.payload.codes.find((row) => row.id === signupInvite.id);
  assert.ok(usedView);
  assert.equal(usedView.code, null);
  assert.equal(adminCodes.raw.includes(signupCode), false);
  pass("管理员 API 对 USED 邀请码只返回永久遮盖值");

  const revocable = await prisma.inviteCode.create({ data: { code: revokeCode, note: marker } });
  inviteIds.push(revocable.id);
  const revoke = await jsonRequest(`/api/admin/invites/${revocable.id}`, {
    method: "DELETE",
    headers: { cookie: adminCookie },
    redirect: "manual"
  });
  assert.equal(revoke.response.status, 200, revoke.raw.slice(0, 300));
  const revokedDb = await prisma.inviteCode.findUniqueOrThrow({ where: { id: revocable.id } });
  assert.equal(revokedDb.status, "REVOKED");
  assert.equal(revokedDb.code, `__RETIRED_REVOKED_${revocable.id}`);
  const codesAfterRevoke = await jsonRequest("/api/admin/invites", {
    headers: { cookie: adminCookie },
    redirect: "manual"
  });
  const revokedView = codesAfterRevoke.payload.codes.find((row) => row.id === revocable.id);
  assert.equal(revokedView.code, null);
  assert.equal(codesAfterRevoke.raw.includes(revokeCode), false);
  pass("REVOKED 邀请码在数据库和管理员 API 中都不可恢复");

  const raceInvite = await prisma.inviteCode.create({ data: { code: raceCode, note: marker } });
  inviteIds.push(raceInvite.id);
  const [raceRegister, raceRevoke] = await Promise.all([
    postJson(
      "/api/member/register-invite",
      { username: raceUsername, code: raceCode, password: racePassword },
      { ip: "198.51.100.155" }
    ),
    jsonRequest(`/api/admin/invites/${raceInvite.id}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
      redirect: "manual"
    })
  ]);
  const raceDb = await prisma.inviteCode.findUniqueOrThrow({ where: { id: raceInvite.id } });
  if (raceRegister.response.status === 200) {
    assert.equal(raceRevoke.response.status, 409, raceRevoke.raw.slice(0, 300));
    assert.equal(raceDb.status, "USED");
    assert.ok(raceDb.memberId);
    memberIds.push(raceDb.memberId);
  } else {
    assert.equal(raceRegister.response.status, 400, raceRegister.raw.slice(0, 300));
    assert.equal(raceRevoke.response.status, 200, raceRevoke.raw.slice(0, 300));
    assert.equal(raceDb.status, "REVOKED");
    assert.equal(raceDb.memberId, null);
    assert.equal(await prisma.memberUser.findUnique({ where: { username: raceUsername } }), null);
  }
  assert.notEqual(
    raceRegister.response.status === 200 && raceRevoke.response.status === 200,
    true,
    "注册和作废不能同时成功"
  );
  pass("邀请码注册与管理员作废并发时只有一个条件抢占胜出，不会出现已作废却已开户");

  const versionBeforeLogout = createdMember.tokenVersion;
  const logout = await jsonRequest("/api/member/logout", {
    method: "POST",
    headers: { cookie: signupCookie }
  });
  assert.equal(logout.response.status, 200);
  const versionAfterLogout = await prisma.memberUser.findUniqueOrThrow({
    where: { id: signupMemberId },
    select: { tokenVersion: true }
  });
  assert.equal(versionAfterLogout.tokenVersion, versionBeforeLogout + 1);
  await assertLoggedOut(signupCookie, signupWorkId);
  pass("登出递增 tokenVersion，已签发 JWT 无法再读会员身份或私密作品");

  const loginForChange = await login(newUsername, newPassword, "198.51.100.145");
  assert.equal(loginForChange.response.status, 200, JSON.stringify(loginForChange.payload));
  const preChangeCookie = authCookieFrom(loginForChange.response, "memberSession");
  const change = await postJson(
    "/api/member/password",
    { currentPassword: newPassword, newPassword: changedPassword },
    { cookie: preChangeCookie, ip: "198.51.100.146" }
  );
  assert.equal(change.response.status, 200, JSON.stringify(change.payload));
  await assertLoggedOut(preChangeCookie, signupWorkId);
  const oldPasswordLogin = await login(newUsername, newPassword, "198.51.100.147");
  assert.equal(oldPasswordLogin.response.status, 401);
  const changedPasswordLogin = await login(newUsername, changedPassword, "198.51.100.148");
  assert.equal(changedPasswordLogin.response.status, 200, JSON.stringify(changedPasswordLogin.payload));
  pass("主动改密吊销全部旧 JWT，旧密码失效且新密码可登录");

  const legacyHash = await bcrypt.hash(legacyCode, 12);
  const legacyMember = await prisma.memberUser.create({
    data: {
      username: legacyUsername,
      passwordHash: legacyHash,
      credentialState: "LEGACY_INVITE_UPGRADE_REQUIRED"
    }
  });
  memberIds.push(legacyMember.id);
  const legacyInvite = await prisma.inviteCode.create({
    // 故意模拟仍残留明文的异常历史行；序列化层仍必须 fail-closed，升级时也会清理。
    data: {
      code: legacyCode,
      status: "USED",
      note: marker,
      memberId: legacyMember.id,
      usedAt: new Date()
    }
  });
  inviteIds.push(legacyInvite.id);
  legacyWorkId = (await prisma.creativeWork.create({
    data: {
      ownerId: legacyMember.id,
      anonId: null,
      genreId: genre.id,
      mode: "VOICE_FIRST",
      depth: "SHORT",
      status: "DRAFT",
      topic: marker,
      title: "legacy private work",
      content: "legacy private content",
      draftGeneratedAt: new Date()
    }
  })).id;

  const legacyAdminView = await jsonRequest("/api/admin/invites", {
    headers: { cookie: adminCookie },
    redirect: "manual"
  });
  assert.equal(legacyAdminView.response.status, 200);
  assert.equal(
    legacyAdminView.payload.codes.find((row) => row.id === legacyInvite.id)?.code,
    null
  );
  assert.equal(legacyAdminView.raw.includes(legacyCode), false);

  const legacyAttempt = await login(legacyUsername, legacyCode, "198.51.100.149");
  assert.equal(legacyAttempt.response.status, 428, JSON.stringify(legacyAttempt.payload));
  assert.equal(legacyAttempt.payload.requiresCredentialUpgrade, true);
  const upgradeCookie = authCookieFrom(legacyAttempt.response, "memberCredentialUpgrade");
  assertAuthCookieAttributes(
    legacyAttempt.response,
    "memberCredentialUpgrade",
    upgradeCookie
  );
  assert.throws(() => authCookieFrom(legacyAttempt.response, "memberSession"));

  await assertLoggedOut(upgradeCookie, legacyWorkId);
  const forgedSessionCookie = cookieHeaderForAuthValue(
    "memberSession",
    authCookieValue(upgradeCookie)
  );
  await assertLoggedOut(forgedSessionCookie, legacyWorkId);
  pass("旧邀请码只获得短时、路径及 purpose 受限的升级凭据，不能读取私密内容");

  const equivalentCodePassword = await postJson(
    "/api/member/upgrade-credential",
    { password: legacyCode.toLowerCase() },
    { cookie: upgradeCookie, ip: "198.51.100.154" }
  );
  assert.equal(equivalentCodePassword.response.status, 400);
  assert.match(String(equivalentCodePassword.payload.error || ""), /旧邀请码/);
  const stillLegacy = await prisma.memberUser.findUniqueOrThrow({ where: { id: legacyMember.id } });
  assert.equal(stillLegacy.credentialState, "LEGACY_INVITE_UPGRADE_REQUIRED");
  assert.equal(stillLegacy.tokenVersion, legacyMember.tokenVersion);
  pass("旧邀请码的大小写变体也不能被设置为新密码");

  const upgrade = await postJson(
    "/api/member/upgrade-credential",
    { password: legacyPassword },
    { cookie: upgradeCookie, ip: "198.51.100.150" }
  );
  assert.equal(upgrade.response.status, 200, JSON.stringify(upgrade.payload));
  assert.throws(() => authCookieFrom(upgrade.response, "memberSession"));

  const upgradedMember = await prisma.memberUser.findUniqueOrThrow({ where: { id: legacyMember.id } });
  const upgradedInvite = await prisma.inviteCode.findUniqueOrThrow({ where: { id: legacyInvite.id } });
  assert.equal(upgradedMember.credentialState, "ACTIVE");
  assert.equal(upgradedMember.tokenVersion, legacyMember.tokenVersion + 1);
  assert.equal(await bcrypt.compare(legacyPassword, upgradedMember.passwordHash), true);
  assert.equal(await bcrypt.compare(legacyCode, upgradedMember.passwordHash), false);
  assert.equal(upgradedInvite.code, `__RETIRED_USED_${legacyInvite.id}`);

  const replayUpgrade = await postJson(
    "/api/member/upgrade-credential",
    { password: `Rp!3-${randomUUID()}` },
    { cookie: upgradeCookie, ip: "198.51.100.151" }
  );
  assert.equal(replayUpgrade.response.status, 401);
  const oldCodeAfterUpgrade = await login(legacyUsername, legacyCode, "198.51.100.152");
  assert.equal(oldCodeAfterUpgrade.response.status, 401);
  const legacyNewLogin = await login(legacyUsername, legacyPassword, "198.51.100.153");
  assert.equal(legacyNewLogin.response.status, 200, JSON.stringify(legacyNewLogin.payload));
  const legacyMemberCookie = authCookieFrom(legacyNewLogin.response, "memberSession");
  const legacyWorks = await jsonRequest("/api/public/creation/works", {
    headers: { cookie: legacyMemberCookie }
  });
  assert.equal(legacyWorks.payload.works.some((work) => work.id === legacyWorkId), true);
  pass("历史会员完成升级后旧码和升级 cookie 立即失效，仅新密码能建立会员会话");

  console.log(`\nAll ${checks} member authentication security checks passed.`);
} finally {
  await prisma.creativeWork.deleteMany({ where: { topic: marker } }).catch(() => undefined);
  if (inviteIds.length > 0) {
    await prisma.inviteCode.deleteMany({ where: { id: { in: inviteIds } } }).catch(() => undefined);
  }
  await prisma.inviteCode.deleteMany({ where: { note: marker } }).catch(() => undefined);
  if (memberIds.length > 0) {
    await prisma.memberUser.deleteMany({ where: { id: { in: memberIds } } }).catch(() => undefined);
  }
  await prisma.memberUser.deleteMany({
    where: { username: { in: [newUsername, legacyUsername, raceUsername] } }
  }).catch(() => undefined);
  await prisma.$disconnect();
}
