import { NextResponse } from "next/server";

/**
 * 返回服务端 303 跳转（相对 Location）。
 * 不依赖 Host / X-Forwarded-* 头，避免反代配置不当时跳到 localhost。
 */
export function redirectTo(path: string, requestOrStatus?: Request | number, statusArg = 303) {
  let status = statusArg;
  if (typeof requestOrStatus === "number") {
    status = requestOrStatus;
  }
  return new NextResponse(null, { status, headers: { Location: path } });
}
