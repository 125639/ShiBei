import { NextResponse } from "next/server";

/**
 * 返回服务端 303 跳转。
 *
 * 解析顺序：
 *   1. 传入 request → 用 x-forwarded-host / host 头构造绝对 URL（反代友好）
 *   2. 没传 request → 直接返回相对 Location 头，浏览器会用当前页面 origin
 *      自动 resolve（任何部署 / 端口 / 域名 / 反代场景都正确）
 *
 * 重要：本函数不再读取 NEXT_PUBLIC_SITE_URL，也不再回退 localhost。
 * 这样任何 API handler 即使忘了传 request，也不会把用户带到错误的域名。
 */
export function redirectTo(path: string, requestOrStatus?: Request | number, statusArg = 303) {
  let request: Request | undefined;
  let status = statusArg;
  if (typeof requestOrStatus === "number") {
    status = requestOrStatus;
  } else if (requestOrStatus) {
    request = requestOrStatus;
  }

  if (request) {
    const base = resolveBaseFromRequest(request);
    if (base) {
      try {
        return NextResponse.redirect(new URL(path, base), status);
      } catch {
        // 退化到相对 Location
      }
    }
  }
  // 相对 Location：浏览器自动用当前页面 origin resolve，部署无关
  return new NextResponse(null, { status, headers: { Location: path } });
}

function resolveBaseFromRequest(request: Request): string | undefined {
  try {
    const url = new URL(request.url);
    const headerHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
    const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(/:$/, "");
    if (headerHost) return `${proto}://${headerHost}`;
    return url.origin;
  } catch {
    return undefined;
  }
}
