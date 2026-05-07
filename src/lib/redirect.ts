import { NextResponse } from "next/server";

export function redirectTo(path: string, requestOrStatus?: Request | number, statusArg = 303) {
  let status = statusArg;
  let req: Request | undefined;
  if (typeof requestOrStatus === "number") {
    status = requestOrStatus;
  } else {
    req = requestOrStatus;
  }

  if (req) {
    const origin = resolveOrigin(req);
    if (origin) {
      return new NextResponse(null, { status, headers: { Location: `${origin}${path}` } });
    }
  }

  const fallback = envSiteOrigin();
  if (fallback) {
    return new NextResponse(null, { status, headers: { Location: `${fallback}${path}` } });
  }

  return new NextResponse(null, { status, headers: { Location: path } });
}

function resolveOrigin(req: Request): string | null {
  const xfHost = req.headers.get("x-forwarded-host");
  const xfProto = req.headers.get("x-forwarded-proto");
  const host = xfHost || req.headers.get("host");
  if (!host) return null;
  if (host.startsWith("localhost") || host.startsWith("127.")) return null;
  const proto = xfProto || (host.endsWith(":443") ? "https" : "http");
  return `${proto}://${host}`;
}

function envSiteOrigin(): string | null {
  const url = process.env.NEXT_PUBLIC_SITE_URL;
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}
