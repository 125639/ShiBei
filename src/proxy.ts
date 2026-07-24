import { NextResponse, type NextRequest } from "next/server";
import { getAppMode, isPathAvailableInAppMode } from "@/lib/app-mode";
import { rejectCrossOriginMutation } from "@/lib/request-origin";
import { requestSiteOrigin } from "@/lib/site-url";

// Next 16 的 proxy 运行在 Node Runtime。这里仍保持最小依赖，不访问数据库，
// 让模式路由与跨来源写请求校验在每次请求上都快速、确定地执行。

// 在 backend 模式下,公开页面(/posts, /news, /stats, /settings, /about, /write,
// /community, /create, /account 等)不面向最终用户,统一重定向到 admin。
// 社区/共创/会员三组页面尤其必须挡住:它们产生的数据不在同步协议里
// (ZIP 只含 posts/videos),放行等于在 backend 上形成内容孤岛。
const BACKEND_PUBLIC_PREFIXES = [
  "/posts",
  "/news",
  "/stats",
  "/settings",
  "/about",
  "/write",
  "/community",
  "/create",
  "/account"
];

function buildRedirectUrl(request: NextRequest, path: string): URL {
  const origin = requestSiteOrigin(request);
  if (origin) return new URL(`${origin}${path}`);

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
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "本路由依赖本地 worker，在 frontend 模式下不可用；请前往 backend 应用操作。" },
        { status: 404 }
      );
    }
    // 页面导航（手输 URL 到被屏蔽的 admin 页）给浏览器一个可用的落点，
    // 而不是渲染一段裸 JSON。
    return NextResponse.redirect(buildRedirectUrl(request, "/admin"));
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
