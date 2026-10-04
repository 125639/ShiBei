import { NextResponse, type NextRequest } from "next/server";
import { getAppMode, isPathAvailableInAppMode } from "@/lib/app-mode";
import { rejectCrossOriginMutation } from "@/lib/request-origin";
import { requestSiteOrigin } from "@/lib/site-url";
import {
  isLanguageExemptPath,
  languageFromPath,
  negotiateLanguage,
  stripLanguagePrefix,
  withLanguagePrefix
} from "@/lib/language";

// Next 16 的 proxy 运行在 Node Runtime。这里仍保持最小依赖，不访问数据库，
// 让模式路由、跨来源写请求校验与语言规范化在每次请求上都快速、确定地执行。

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

/** 形如 `/firefly-banner.svg` 的根级静态文件：有扩展名，不该被加语言段。 */
function looksLikeStaticFile(pathname: string): boolean {
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return last.includes(".");
}

function buildRedirectUrl(request: NextRequest, path: string): URL {
  const origin = requestSiteOrigin(request);
  if (origin) return new URL(`${origin}${path}`);

  const url = request.nextUrl.clone();
  url.pathname = path;
  return url;
}

/**
 * 公开路径缺少语言段时，返回应重定向到的 Location；无需重定向返回 null。
 *
 * 独立成纯函数是为了可测：这里最容易犯的错是用 request.nextUrl 直接拼
 * Location。在反代/隧道后面 nextUrl 是内网地址（http://127.0.0.1:PORT），
 * 那样会把访客甩到他自己的本机上，而本地开发完全测不出来——nextUrl 在直连
 * 场景恰好就是对外地址。必须走 requestSiteOrigin 还原访客实际访问的源。
 *
 * 拿不到可信源时返回相对 Location，由浏览器按当前源解析，绝不回落到内网地址。
 */
export function languageRedirectLocation(
  request: Pick<Request, "url" | "headers">,
  pathname: string,
  search: string
): string | null {
  if (isLanguageExemptPath(pathname) || looksLikeStaticFile(pathname) || languageFromPath(pathname)) {
    return null;
  }
  const language = negotiateLanguage(request.headers.get("accept-language"));
  const localized = `${withLanguagePrefix(language, pathname)}${search}`;
  const origin = requestSiteOrigin(request);
  return origin ? `${origin}${localized}` : localized;
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

  // backend 模式的公开页拦截放在语言规范化之前：否则 `/` 会先被重定向到
  // `/zh`，再被这里重定向到 `/admin`，白白多一跳。按去掉语言段的路径匹配，
  // 使 `/zh/posts` 与 `/posts` 表现一致。
  if (mode === "backend") {
    const bare = stripLanguagePrefix(pathname);
    if (bare === "/" || BACKEND_PUBLIC_PREFIXES.some((p) => bare === p || bare.startsWith(p + "/"))) {
      return NextResponse.redirect(buildRedirectUrl(request, "/admin"));
    }
  }

  // 语言规范化：公开路径必须带 /zh 或 /en 段。
  //
  // 保留这一跳是为了兼容既有书签、RSS 里的旧链接和外部引用——它们都指向无
  // 前缀路径。目标语言按 Accept-Language 协商，所以这是**内容协商**的结果：
  // 必须用 307（临时）并声明 Vary，不能用 308，否则浏览器/CDN 会把某一个
  // 访客协商出的语言永久缓存给所有人。
  const location = languageRedirectLocation(request, pathname, request.nextUrl.search);
  if (location) {
    // 用裸 Location 而不是 NextResponse.redirect(URL)：后者要求绝对 URL，
    // 拿不到可信源时就没法回落到相对地址（与 lib/redirect.ts 同口径）。
    return new NextResponse(null, {
      status: 307,
      headers: { Location: location, Vary: "Accept-Language" }
    });
  }

  return NextResponse.next();
}

// 不拦截静态资源、内置路径。注意:正则需要排除 /_next/*, /uploads/*, 静态文件、
// 健康检查与同步路由。健康检查必须始终可访问，否则反代/容器运行时无法判断状态。
// videos/music 上传也要排除：代理层不应读取或缓冲大文件 FormData，
// 否则上传会增加无意义的内存与延迟；sync 也因同样原因排除。
// 注意：排除后中间件的跨来源校验也不再覆盖该路径，安全边界由路由自身的
// isSameOriginMutation() 承担（见 upload/route.ts）。
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|uploads/|api/health|api/admin/sync|api/admin/videos|api/admin/music).*)",
  ],
};
