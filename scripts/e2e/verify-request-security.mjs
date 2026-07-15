/** 真实 HTTP 验证 JSON Content-Type 与同源 mutation 边界。 */
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";
import { cookieHeaderForAuthValue } from "./auth-cookie-names.mjs";

try {
  if (typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
} catch {}

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3200").replace(/\/$/, "");
const ALTERNATE_BASE = (process.env.ALTERNATE_BASE_URL || "").replace(/\/$/, "");
const prisma = new PrismaClient();
let checks = 0;

function pass(label) {
  checks += 1;
  console.log(`PASS  ${label}`);
}

async function adminCookie() {
  const admin = await prisma.adminUser.findFirst({ select: { id: true, tokenVersion: true } });
  assert.ok(admin);
  const secret = process.env.AUTH_SECRET || "dev-auth-secret-change-me";
  if (!process.env.AUTH_SECRET && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is required against a production server");
  }
  const token = await new SignJWT({ userId: admin.id, ver: admin.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(secret));
  return cookieHeaderForAuthValue("adminSession", token);
}

async function status(path, init) {
  const response = await fetch(`${BASE}${path}`, { redirect: "manual", ...init });
  await response.body?.cancel().catch(() => undefined);
  return response.status;
}

try {
  assert.equal(await status("/api/member/login", {
    method: "POST",
    headers: { Origin: BASE, "Sec-Fetch-Site": "same-origin", "Content-Type": "text/plain" },
    body: JSON.stringify({ account: "nobody", secret: "irrelevant" })
  }), 415);
  assert.equal(await status("/api/public/creation/works", {
    method: "POST",
    headers: {
      Origin: BASE,
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "mode=VOICE_FIRST"
  }), 415);
  assert.equal(await status("/api/admin/login", {
    method: "POST",
    headers: {
      Origin: BASE,
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username: "admin", password: "not-a-real-password" })
  }), 415);
  pass("会员登录、管理员表单登录与作品写操作拒绝错误媒体类型");

  const cookie = await adminCookie();
  assert.equal(await status("/api/admin/community-works/not-a-work", {
    method: "POST",
    headers: {
      Origin: BASE,
      "Sec-Fetch-Site": "same-origin",
      Cookie: cookie,
      "Content-Type": "text/plain"
    },
    body: JSON.stringify({ action: "UNPUBLISH", reason: "probe" })
  }), 415);
  pass("管理员治理接口在有效会话下仍先拒绝 text/plain");

  for (const [path, method] of [
    ["/api/member/logout", "POST"],
    ["/api/admin/community-works/not-a-work", "POST"],
    // 这两个大上传前缀绕过 middleware，必须由 route 内守卫拦截。
    ["/api/admin/videos/reorder", "POST"],
    ["/api/admin/music", "DELETE"],
    // 大 ZIP 同步前缀同样绕过 middleware。
    ["/api/admin/sync/pull", "POST"]
  ]) {
    assert.equal(await status(path, {
      method,
      headers: {
        Origin: "https://evil.example.invalid",
        "Sec-Fetch-Site": "same-site",
        Cookie: cookie,
        "Content-Type": "application/json"
      },
      body: method === "GET" ? undefined : "{}"
    }), 403, `${method} ${path}`);
  }
  pass("中间件与大上传/同步旁路均拒绝同站恶意子域 Origin");

  assert.equal(await status("/api/member/login", {
    method: "POST",
    headers: { Origin: BASE, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ account: `does-not-exist-${Date.now()}`, secret: "wrong-password" })
  }), 401);
  pass("精确同源 application/json 请求仍正常进入业务校验");

  if (ALTERNATE_BASE) {
    const response = await fetch(`${ALTERNATE_BASE}/api/member/login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Origin: ALTERNATE_BASE,
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ account: `alternate-host-${Date.now()}`, secret: "wrong-password" })
    });
    await response.body?.cancel().catch(() => undefined);
    assert.equal(response.status, 401);
    pass("通过浏览器实际 Host/IP 访问时，同源登录不会被误判为跨来源");
  }

  console.log(`\nAll ${checks} real request-security checks passed.`);
} finally {
  await prisma.$disconnect();
}
