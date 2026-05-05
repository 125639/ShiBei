import { NextResponse } from "next/server";

/**
 * 返回到 admin 页面的服务端 303 跳转。
 *
 * 解析顺序（前者命中即返回）：
 *   1. request 的真实 host（含 x-forwarded-host / x-forwarded-proto，反向代理友好）
 *   2. NEXT_PUBLIC_SITE_URL 环境变量
 *   3. http://localhost:3000（最终兜底，仅在 1/2 都拿不到时使用；
 *      绝不能写死任何具体服务器 IP——那会把陌生用户的浏览器带去那台机器）
 */
export function redirectTo(path: string, requestOrStatus?: Request | number, statusArg = 303) {
  let request: Request | undefined;
  let status = statusArg;
  if (typeof requestOrStatus === "number") {
    status = requestOrStatus;
  } else if (requestOrStatus) {
    request = requestOrStatus;
  }

  const base = resolveBase(request);
  return NextResponse.redirect(new URL(path, base), status);
}

function resolveBase(request?: Request): string {
  if (request) {
    try {
      const url = new URL(request.url);
      const headerHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
      const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(/:$/, "");
      if (headerHost) return `${proto}://${headerHost}`;
      return url.origin;
    } catch {
      // ignore
    }
  }
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl) {
    try {
      return new URL(envUrl).origin;
    } catch {
      // ignore
    }
  }
  return "http://localhost:3000";
}
