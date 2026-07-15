import { NextResponse, type NextRequest } from "next/server";
import { getAppMode, isPathAvailableInAppMode } from "@/lib/app-mode";
import { rejectCrossOriginMutation } from "@/lib/request-origin";

// Next 16 的 proxy 运行在 Node Runtime。这里仍保持最小依赖，不访问数据库，
// 让模式路由与跨来源写请求校验在每次请求上都快速、确定地执行。

// 在 backend 模式下,公开页面(/posts, /news, /stats, /settings, /about, /write 等)
// 不面向最终用户,统一重定向到 admin。
const BACKEND_PUBLIC_PREFIXES = ["/posts", "/news", "/stats", "/settings", "/about", "/write"];

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

export function proxy(request: NextRequest) {
  const mode = getAppMode();
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    const originDenied = rejectCrossOriginMutation(request);
    if (originDenied) return originDenied;
  }

  if (!isPathAvailableInAppMode(pathname, mode)) {
    return NextResponse.json(
      { error: "本路由依赖本地 worker，在 frontend 模式下不可用；请前往 backend 应用操作。" },
      { status: 404 }
    );
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
// videos/music 上传也要排除：代理层不应读取或缓冲大文件 FormData，
// 否则上传会增加无意义的内存与延迟；sync 也因同样原因排除。
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|uploads/|api/health|api/admin/sync|api/admin/videos|api/admin/music).*)",
  ],
};
