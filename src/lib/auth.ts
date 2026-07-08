import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./prisma";

const cookieName = "shibei_admin_session";

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
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) return process.env.NODE_ENV === "production";

  try {
    return new URL(siteUrl).protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production";
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
  store.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: "/",
    maxAge: 60 * 60 * 24 * 7
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(cookieName);
}

export async function getSession() {
  const store = await cookies();
  const token = store.get(cookieName)?.value;
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
