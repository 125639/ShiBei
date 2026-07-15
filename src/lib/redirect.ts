import { NextResponse } from "next/server";
import { configuredSiteOrigin, requestSiteOrigin } from "./site-url";

export function redirectTo(path: string, requestOrStatus?: Request | number, statusArg = 303) {
  let status = statusArg;
  let req: Request | undefined;
  if (typeof requestOrStatus === "number") {
    status = requestOrStatus;
  } else {
    req = requestOrStatus;
  }

  if (req) {
    const origin = requestSiteOrigin(req);
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

function envSiteOrigin(): string | null {
  return configuredSiteOrigin();
}
