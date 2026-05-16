import { NextResponse, type NextRequest } from "next/server";

// 注意:此文件运行在 Edge Runtime,不能 import 任何会触摸 Node API 或数据库的模块。
// 因此这里直接读 process.env(Edge 也支持)而不去 import @/lib/app-mode(它本身是纯 env,
// 但保持中间件最小依赖更稳)。

type AppMode = "frontend" | "backend" | "full";

function getMode(): AppMode {
  const raw = (process.env.APP_MODE || "full").trim().toLowerCase();
  if (raw === "frontend" || raw === "backend" || raw === "full") return raw;
  return "full";
}

// 在 frontend 模式下应被屏蔽(404)的路径前缀。
// 这些路由依赖 BullMQ / 抓取 / AI 模型等后端能力,在前端形态下不可用。
const FRONTEND_BLOCKED_PREFIXES = [
  "/admin/sources",
  "/admin/modules",
  "/admin/auto-curation",
  "/api/admin/sources",
  "/api/admin/modules",
  "/api/admin/content-topics",
  "/api/admin/run",
  "/api/admin/settings/auto-curation",
  "/api/admin/content-styles",
  "/api/admin/model-configs",
];

// 在 backend 模式下,公开页面(/posts, /news, /videos, /stats, /settings, /about, /write 等)
// 不面向最终用户,统一重定向到 admin。
const BACKEND_PUBLIC_PREFIXES = ["/posts", "/news", "/videos", "/stats", "/settings", "/about", "/write"];

function buildRedirectUrl(request: NextRequest, path: string): URL {
  const xfHost = request.headers.get("x-forwarded-host");
  const xfProto = request.headers.get("x-forwarded-proto");
  const host = xfHost || request.headers.get("host");

  if (host && !host.startsWith("localhost") && !host.startsWith("127.")) {
    // 生产环境基本都跑在 HTTPS 后面，反代如果配了 X-Forwarded-Proto 优先用它；
    // 没配时默认 https，避免把 HTTPS 用户重定向到 HTTP（Secure cookie 不会被携带，
    // 登录会循环到 /admin/login）。原来的 host.endsWith(":443") 启发式实际上几乎
    // 永不为真——HTTPS 标准请求的 Host 头不带 :443。
    const proto = xfProto || "https";
    return new URL(`${proto}://${host}${path}`);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (siteUrl) {
    try {
      const parsed = new URL(siteUrl);
      if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
        return new URL(`${parsed.origin}${path}`);
      }
    } catch {}
  }

  const url = request.nextUrl.clone();
  url.pathname = path;
  return url;
}

export function middleware(request: NextRequest) {
  const mode = getMode();
  const { pathname } = request.nextUrl;

  if (mode === "frontend") {
    if (FRONTEND_BLOCKED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      return NextResponse.json(
        { error: "本路由在 frontend 模式下不可用,请前往 backend 应用操作。" },
        { status: 404 }
      );
    }
  }

  if (mode === "backend") {
    if (pathname === "/" || BACKEND_PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      const url = buildRedirectUrl(request, "/admin");
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

// 不拦截静态资源、内置路径。注意:正则需要排除 /_next/*, /uploads/*, 静态文件、
// 健康检查与同步路由。健康检查必须始终可访问，否则反代/容器运行时无法判断状态。
// videos/music 上传也要排除：Next.js 15.5 给经过 middleware 的请求加了
// 10MB body 上限（middlewareClientMaxBodySize），不排除的话大文件 FormData
// 解析会失败抛 500。sync 早就因为同样原因排除了。
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|uploads/|api/health|api/admin/sync|api/admin/videos|api/admin/music).*)",
  ],
};
