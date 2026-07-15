const DEFAULT_SITE_ORIGIN = "http://localhost:3000";

/**
 * Read through a dynamic key so the legacy NEXT_PUBLIC_* value remains a
 * runtime compatibility input instead of being frozen into the client/server
 * bundles by Next at image build time.
 */
function runtimeEnv(name: "PUBLIC_URL" | "NEXT_PUBLIC_SITE_URL") {
  return process.env[name]?.trim() || "";
}

export function parseHttpOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseConfiguredOrigin(value: string): string | null {
  const origin = parseHttpOrigin(value);
  if (!origin) return null;
  const parsed = new URL(value);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
  return origin;
}

/** PUBLIC_URL is authoritative; NEXT_PUBLIC_SITE_URL is migration-only. */
export function configuredSiteOrigin(): string | null {
  const publicUrl = runtimeEnv("PUBLIC_URL");
  if (publicUrl) {
    const origin = parseConfiguredOrigin(publicUrl);
    if (!origin) {
      throw new Error("PUBLIC_URL 必须是不含用户信息、路径、查询或片段的 http:// 或 https:// 站点源");
    }
    return origin;
  }
  const legacyUrl = runtimeEnv("NEXT_PUBLIC_SITE_URL");
  if (!legacyUrl) return null;
  const legacyOrigin = parseConfiguredOrigin(legacyUrl);
  if (!legacyOrigin) {
    throw new Error("NEXT_PUBLIC_SITE_URL 必须是不含用户信息、路径、查询或片段的 http:// 或 https:// 站点源");
  }
  return legacyOrigin;
}

export function siteOrigin() {
  return configuredSiteOrigin() || DEFAULT_SITE_ORIGIN;
}

/**
 * Redirects use the configured public origin when present. Without one, infer
 * the browser-visible origin from conventional proxy headers and finally the
 * actual request URL. Forwarding headers are considered only when
 * TRUST_PROXY_HOPS opts into a trusted reverse proxy, and every resulting
 * origin still passes strict URL parsing.
 */
export function requestSiteOrigin(request: Pick<Request, "url" | "headers">): string | null {
  const configured = configuredSiteOrigin();
  if (configured) return configured;

  const requestOrigin = parseHttpOrigin(request.url);
  const trustForwarded = trustedProxyHops() > 0;
  const forwardedHost = trustForwarded
    ? lastForwardedValue(request.headers.get("x-forwarded-host"))
    : "";
  const forwardedProto = trustForwarded
    ? lastForwardedValue(request.headers.get("x-forwarded-proto"))
    : "";
  const host = forwardedHost || request.headers.get("host")?.trim() || "";
  const requestProtocol = requestOrigin ? new URL(requestOrigin).protocol.slice(0, -1) : "";
  const proto = (forwardedProto || requestProtocol).toLowerCase();

  if (host && (proto === "http" || proto === "https")) {
    const observed = parseHttpOrigin(`${proto}://${host}`);
    if (observed) return observed;
  }
  return requestOrigin;
}

function lastForwardedValue(value: string | null): string {
  return value?.split(",").at(-1)?.trim() || "";
}

function trustedProxyHops(): number {
  const raw = process.env.TRUST_PROXY_HOPS?.trim() || "";
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) return 0;
  return Math.min(10, Number(raw));
}

export function absoluteSiteUrl(path: string) {
  return new URL(path.startsWith("/") ? path : `/${path}`, siteOrigin()).toString();
}
