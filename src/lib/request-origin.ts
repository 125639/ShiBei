import { NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function normalizedOrigin(value: string | null | undefined): string | null {
  if (!value || value === "null") return null;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

function normalizedHost(value: string | null | undefined): string | null {
  if (!value || value.length > 255 || /[\s\\/@,]/.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
      return null;
    }
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}

export function isSameOriginMutation(request: Pick<Request, "method" | "url" | "headers">): boolean {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return true;

  const requestOrigin = normalizedOrigin(request.url);
  const configuredOrigin = normalizedOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  const allowed = new Set([requestOrigin, configuredOrigin].filter((value): value is string => Boolean(value)));
  const rawOrigin = request.headers.get("origin");
  const origin = normalizedOrigin(rawOrigin);
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();

  if (rawOrigin !== null) {
    // `Origin: null`, malformed values, and sibling subdomains are never the
    // application origin even though browser SameSite cookies may be attached.
    if (!origin) return false;
    if (allowed.has(origin)) return true;

    // Next may canonicalize Request.url to NEXT_PUBLIC_SITE_URL even when the
    // browser reached this same server through its IP address or a public host.
    // The browser's Host header still identifies the request target. Accept
    // that dynamic origin only when Fetch Metadata independently says the
    // navigation is exact same-origin; sibling domains remain rejected.
    const requestHost = normalizedHost(request.headers.get("host"));
    const originHost = normalizedHost(new URL(origin).host);
    return fetchSite === "same-origin" && Boolean(requestHost && originHost === requestHost);
  }

  if (fetchSite) {
    // Browser mutation requests are expected to carry Origin. If a privacy
    // mode strips it, only an explicitly same-origin request remains eligible.
    return fetchSite === "same-origin";
  }

  // Non-browser workers/CLI calls do not carry browser cookies implicitly and
  // commonly omit both Fetch Metadata and Origin. Authentication still applies.
  return true;
}

export function rejectCrossOriginMutation(
  request: Pick<Request, "method" | "url" | "headers">
): NextResponse | null {
  if (isSameOriginMutation(request)) return null;
  return NextResponse.json(
    { error: "拒绝跨来源的状态修改请求" },
    { status: 403, headers: { "Cache-Control": "no-store" } }
  );
}
