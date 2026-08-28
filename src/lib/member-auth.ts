import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import {
  getAuthCookieName,
  getAuthCookiePath,
  getAuthSecret,
  shouldUseSecureCookies
} from "./auth";
import { anonCreationSeedFromRequest, deriveAnonIdFromBootstrapSeed } from "./anon-bootstrap";
import { prisma } from "./prisma";

// 读者会员会话：与管理员会话完全独立的 cookie，互不越权。
// 匿名创作身份：未登录用户的作品所有权凭据。丢失 cookie 即失去对未发布草稿的访问。
// 它与会员身份严格隔离：登录/注册不会迁移匿名内容，登录期间也不会以此 cookie
// 访问匿名内容；退出登录后，同一浏览器仍可继续使用原匿名身份。

const MEMBER_SESSION_DAYS = 30;
const MEMBER_UPGRADE_MINUTES = 10;
const MEMBER_SESSION_PURPOSE = "member-session";
const MEMBER_UPGRADE_PURPOSE = "member-credential-upgrade";
const ANON_COOKIE_DAYS = 180;

export type MemberSession = { memberId: string; tokenVersion: number };

export class AnonymousBootstrapRequiredError extends Error {
  readonly status = 428;

  constructor() {
    super("匿名身份已失效，请重新初始化后再创建内容");
    this.name = "AnonymousBootstrapRequiredError";
  }
}

export async function createMemberSession(memberId: string, tokenVersion: number) {
  return new SignJWT({ memberId, ver: tokenVersion, purpose: MEMBER_SESSION_PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MEMBER_SESSION_DAYS}d`)
    .sign(getAuthSecret());
}

export async function createMemberCredentialUpgradeToken(memberId: string, tokenVersion: number) {
  return new SignJWT({ memberId, ver: tokenVersion, purpose: MEMBER_UPGRADE_PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MEMBER_UPGRADE_MINUTES}m`)
    .sign(getAuthSecret());
}

export async function setMemberSessionCookie(token: string) {
  const store = await cookies();
  store.set(getAuthCookieName("memberSession"), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: getAuthCookiePath("memberSession"),
    maxAge: 60 * 60 * 24 * MEMBER_SESSION_DAYS
  });
}

export async function clearMemberSessionCookie() {
  const store = await cookies();
  store.set(getAuthCookieName("memberSession"), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: getAuthCookiePath("memberSession"),
    maxAge: 0
  });
}

export async function setMemberCredentialUpgradeCookie(token: string) {
  const store = await cookies();
  store.set(getAuthCookieName("memberCredentialUpgrade"), token, {
    httpOnly: true,
    sameSite: "strict",
    secure: shouldUseSecureCookies(),
    // `__Host-` mandates Path=/ in production. The JWT's dedicated purpose,
    // ten-minute expiry and endpoint-only reader keep this credential scoped;
    // development retains the narrower path where the prefix is unavailable.
    path: getAuthCookiePath("memberCredentialUpgrade"),
    maxAge: 60 * MEMBER_UPGRADE_MINUTES
  });
}

export async function clearMemberCredentialUpgradeCookie() {
  const store = await cookies();
  store.set(getAuthCookieName("memberCredentialUpgrade"), "", {
    httpOnly: true,
    sameSite: "strict",
    secure: shouldUseSecureCookies(),
    path: getAuthCookiePath("memberCredentialUpgrade"),
    maxAge: 0
  });
}

async function verifyMemberToken(
  token: string,
  purpose: typeof MEMBER_SESSION_PURPOSE | typeof MEMBER_UPGRADE_PURPOSE,
  credentialState: "ACTIVE" | "LEGACY_INVITE_UPGRADE_REQUIRED"
): Promise<MemberSession | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    const memberId = payload.memberId;
    const tokenVersion = payload.ver;
    if (
      typeof memberId !== "string" ||
      !memberId ||
      payload.purpose !== purpose ||
      typeof tokenVersion !== "number" ||
      !Number.isInteger(tokenVersion)
    ) {
      return null;
    }

    // JWT 必须与数据库当前版本和凭据状态同时匹配；查询失败时由 catch 兜底为未登录。
    const member = await prisma.memberUser.findUnique({
      where: { id: memberId },
      select: { tokenVersion: true, credentialState: true }
    });
    if (
      !member ||
      member.tokenVersion !== tokenVersion ||
      member.credentialState !== credentialState
    ) {
      return null;
    }
    return { memberId, tokenVersion };
  } catch {
    return null;
  }
}

export async function getMemberSession(): Promise<MemberSession | null> {
  const store = await cookies();
  // Never read the old unprefixed production name. It can be supplied by a
  // sibling Domain cookie and ordered before a host-only cookie by Path.
  const token = store.get(getAuthCookieName("memberSession"))?.value;
  if (!token) return null;
  return verifyMemberToken(token, MEMBER_SESSION_PURPOSE, "ACTIVE");
}

export async function getMemberCredentialUpgradeSession(): Promise<MemberSession | null> {
  const store = await cookies();
  const token = store.get(getAuthCookieName("memberCredentialUpgrade"))?.value;
  if (!token) return null;
  return verifyMemberToken(token, MEMBER_UPGRADE_PURPOSE, "LEGACY_INVITE_UPGRADE_REQUIRED");
}

export async function getCurrentMember() {
  const session = await getMemberSession();
  if (!session) return null;
  return prisma.memberUser.findUnique({
    where: { id: session.memberId },
    select: { id: true, email: true, username: true, displayName: true, createdAt: true }
  });
}

export async function getAnonId(): Promise<string | null> {
  const store = await cookies();
  return store.get(getAuthCookieName("anonymousIdentity"))?.value || null;
}

function setAnonCookie(
  store: Awaited<ReturnType<typeof cookies>>,
  anonId: string
) {
  store.set(getAuthCookieName("anonymousIdentity"), anonId, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: getAuthCookiePath("anonymousIdentity"),
    maxAge: 60 * 60 * 24 * ANON_COOKIE_DAYS
  });
}

/**
 * 匿名 bootstrap 使用：请求已经带有身份时绝不替换，防止 seed 固定攻击覆盖
 * 正在使用的匿名身份。返回实际保留/写入的身份。
 */
export async function setAnonIdCookieIfMissing(anonId: string): Promise<string> {
  const store = await cookies();
  const existing = store.get(getAuthCookieName("anonymousIdentity"))?.value;
  if (existing) return existing;
  setAnonCookie(store, anonId);
  return anonId;
}

/**
 * Anonymous create endpoints bind a just-completed client bootstrap seed to the
 * same server-secret HMAC identity. Existing cookies always win. A cookie-less
 * request without a valid seed fails closed; generating a fresh random identity
 * here would recreate the exact cross-tab orphan bug this boundary prevents.
 */
export async function ensureAnonIdForCreationRequest(request: Request): Promise<string> {
  const store = await cookies();
  const existing = store.get(getAuthCookieName("anonymousIdentity"))?.value;
  if (existing) return existing;

  const seed = anonCreationSeedFromRequest(request);
  if (!seed) throw new AnonymousBootstrapRequiredError();
  const anonId = deriveAnonIdFromBootstrapSeed(seed);
  setAnonCookie(store, anonId);
  return anonId;
}
