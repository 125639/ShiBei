import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./prisma";

export type AuthCookieKind =
  | "adminSession"
  | "memberSession"
  | "memberCredentialUpgrade"
  | "anonymousIdentity";

const PRODUCTION_COOKIE_NAMES: Record<AuthCookieKind, string> = {
  adminSession: "__Host-shibei_admin_session",
  memberSession: "__Host-shibei_member_session",
  memberCredentialUpgrade: "__Host-shibei_member_credential_upgrade",
  anonymousIdentity: "__Host-shibei_anon_id"
};

// Development deliberately uses a different namespace. Besides making local
// HTTP usable, this prevents tests or a development cookie from accidentally
// being treated as a production credential.
const DEVELOPMENT_COOKIE_NAMES: Record<AuthCookieKind, string> = {
  adminSession: "shibei_dev_admin_session",
  memberSession: "shibei_dev_member_session",
  memberCredentialUpgrade: "shibei_dev_member_credential_upgrade",
  anonymousIdentity: "shibei_dev_anon_id"
};

export function usesHostPrefixedAuthCookies() {
  return process.env.NODE_ENV === "production";
}

export function getAuthCookieName(kind: AuthCookieKind) {
  return (usesHostPrefixedAuthCookies() ? PRODUCTION_COOKIE_NAMES : DEVELOPMENT_COOKIE_NAMES)[kind];
}

/** `__Host-` cookies are required to use Secure + Path=/ and may not set Domain. */
export function getAuthCookiePath(kind: AuthCookieKind) {
  if (usesHostPrefixedAuthCookies()) return "/";
  return kind === "memberCredentialUpgrade" ? "/api/member/upgrade-credential" : "/";
}

export function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET 未配置：拒绝在生产环境使用兜底密钥（任何人都能伪造 admin session）。");
    }
    return new TextEncoder().encode("dev-auth-secret-change-me");
  }
  return new TextEncoder().encode(secret);
}

export function shouldUseSecureCookies() {
  // Production credentials use the browser-enforced `__Host-` prefix. Never
  // weaken Secure because of a mistaken http:// site URL: fail closed instead.
  if (usesHostPrefixedAuthCookies()) return true;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) return false;

  try {
    return new URL(siteUrl).protocol === "https:";
  } catch {
    return false;
  }
}

export async function createSession(userId: string, tokenVersion: number) {
  // ver 声明用于会话吊销：登出/改密时 AdminUser.tokenVersion +1，
  // 已签发但 ver 落后的 JWT 在 getSession 里会被判为失效。
  return new SignJWT({ userId, ver: tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getAuthSecret());
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(getAuthCookieName("adminSession"), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: getAuthCookiePath("adminSession"),
    maxAge: 60 * 60 * 24 * 7
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(getAuthCookieName("adminSession"), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: getAuthCookiePath("adminSession"),
    maxAge: 0
  });
}

export async function getSession() {
  const store = await cookies();
  // Production intentionally never falls back to the legacy unprefixed name:
  // a sibling subdomain can plant a Domain/longer-Path cookie with that name.
  const token = store.get(getAuthCookieName("adminSession"))?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    const userId = String(payload.userId || "");
    if (!userId) return null;
    // 与 DB 里的 tokenVersion 比对，实现会话吊销。缺 ver 的存量旧 token 按 0 处理。
    // DB 不可达时 jwtVerify 之后的查询会抛，落到 catch → 视为未登录（fail-closed）。
    const tokenVer = typeof payload.ver === "number" ? payload.ver : 0;
    const user = await prisma.adminUser.findUnique({
      where: { id: userId },
      select: { tokenVersion: true }
    });
    if (!user || tokenVer !== user.tokenVersion) return null;
    return { userId };
  } catch {
    return null;
  }
}

export async function requireAdmin() {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  return session;
}
