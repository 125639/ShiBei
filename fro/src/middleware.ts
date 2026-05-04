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
  "/api/admin/topics",
  "/api/admin/run",
  "/api/admin/settings/auto-curation",
  "/api/admin/summary-styles",
  "/api/admin/model-configs",
];

// 在 backend 模式下,公开页面(/news, /videos, /stats, /settings, /about, /write 等)
// 不面向最终用户,统一重定向到 admin。
const BACKEND_PUBLIC_PREFIXES = ["/news", "/videos", "/stats", "/settings", "/about", "/write"];

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
      const url = request.nextUrl.clone();
      url.pathname = "/admin";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

// 不拦截静态资源、内置路径。注意:正则需要排除 /_next/*, /uploads/*, 静态文件等。
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|uploads/|api/public/sync|api/admin/sync).*)",
  ],
};
