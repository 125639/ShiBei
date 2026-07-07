import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getAuthSecret, shouldUseSecureCookies } from "./auth";
import { prisma } from "./prisma";

// 读者会员会话：与管理员会话完全独立的 cookie，互不越权。
const memberCookieName = "shibei_member_session";
// 匿名创作身份：未登录用户的作品所有权凭据。丢失 cookie 即失去对未发布草稿的访问，
// 这是匿名模式的固有代价；页面上会提示注册以长期保留作品。
const anonCookieName = "shibei_anon_id";

const MEMBER_SESSION_DAYS = 30;
const ANON_COOKIE_DAYS = 180;

export type MemberSession = { memberId: string };

export async function createMemberSession(memberId: string) {
  return new SignJWT({ memberId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MEMBER_SESSION_DAYS}d`)
    .sign(getAuthSecret());
}

export async function setMemberSessionCookie(token: string) {
  const store = await cookies();
  store.set(memberCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: "/",
    maxAge: 60 * 60 * 24 * MEMBER_SESSION_DAYS
  });
}

export async function clearMemberSessionCookie() {
  const store = await cookies();
  store.delete(memberCookieName);
}

export async function getMemberSession(): Promise<MemberSession | null> {
  const store = await cookies();
  const token = store.get(memberCookieName)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    const memberId = payload.memberId;
    if (typeof memberId !== "string" || !memberId) return null;
    return { memberId };
  } catch {
    return null;
  }
}

export async function getCurrentMember() {
  const session = await getMemberSession();
  if (!session) return null;
  return prisma.memberUser.findUnique({
    where: { id: session.memberId },
    select: { id: true, email: true, displayName: true, createdAt: true }
  });
}

export async function getAnonId(): Promise<string | null> {
  const store = await cookies();
  return store.get(anonCookieName)?.value || null;
}

// 只能在 Route Handler / Server Action 中调用（需要写 cookie）。
export async function ensureAnonId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(anonCookieName)?.value;
  if (existing) return existing;

  const anonId = randomUUID();
  store.set(anonCookieName, anonId, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: "/",
    maxAge: 60 * 60 * 24 * ANON_COOKIE_DAYS
  });
  return anonId;
}

// 注册/登录后把当前浏览器的匿名作品归入账号名下，
// 之后这些作品享有会员的完整删除/导出权。
// 已公开的匿名作品不认领：创作者当时以「匿名 + 不可删除」条款发布，
// 事后认领会让公开页署名从匿名变为实名，并绕过不可删除的承诺。
export async function claimAnonWorks(memberId: string) {
  const anonId = await getAnonId();
  if (!anonId) return 0;
  const result = await prisma.creativeWork.updateMany({
    where: { anonId, ownerId: null, status: { not: "SHARED" } },
    data: { ownerId: memberId }
  });
  return result.count;
}
