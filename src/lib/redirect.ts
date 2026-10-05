import { NextResponse } from "next/server";

/**
 * In-site navigation must stay on the browser's origin, not PUBLIC_URL or the
 * reverse proxy's HTTP upstream. Root-relative Location works for HTTPS,
 * nonstandard ports, tunnels and direct HTTP alike, including handlers that
 * have no Request argument (logout and many admin mutations).
 */
export function redirectTo(path: string, requestOrStatus?: Request | number, statusArg = 303) {
  // Never allow a network-path reference (//host), backslash authority or control
  // characters to turn a same-origin redirect into an external redirect.
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(path)) {
    throw new Error("Redirect target must be a root-relative in-site path");
  }
  const status = typeof requestOrStatus === "number" ? requestOrStatus : statusArg;
  return new NextResponse(null, { status, headers: { Location: path } });
}
