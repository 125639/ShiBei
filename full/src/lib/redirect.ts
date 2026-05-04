import { NextResponse } from "next/server";

/**
 * 返回到 admin 页面的服务端 303 跳转。
 *
 * 优先使用 request 的 origin（兼容内网/公网/反向代理多场景），其次是
 * NEXT_PUBLIC_SITE_URL 环境变量，最后回退 localhost。这样:
 *
 *   - 用户从 47.85.x.x 访问 → 跳回 47.85.x.x
 *   - 用户从 localhost:3000 访问（curl/容器内） → 跳回 localhost:3000
 *   - 用户从内网 IP 访问 → 跳回内网 IP
 *
 * @param path 站内绝对路径，例如 "/admin/sync"
 * @param request 来源请求；不传时退回 NEXT_PUBLIC_SITE_URL
 * @param status HTTP 状态码，默认 303
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
      // request.url 在 Next.js 中已包含真实 host:port，因此直接用 origin 最准。
      return url.origin;
    } catch {
      // ignore，落入下一个回退
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
