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
 * Redirects use the browser-visible origin first when a trusted reverse proxy
 * is declared (TRUST_PROXY_HOPS>0)：隧道（cloudflared）或反代后面的用户访问的是
 * 公网域名，若按 PUBLIC_URL 重定向会把他们打回 http://localhost:PORT。
 * 没有可信代理时保持原行为——PUBLIC_URL 权威，防止直连场景下 Host 头伪造
 * 造成开放重定向。Forwarding headers are considered only when
 * TRUST_PROXY_HOPS opts into a trusted reverse proxy, and every resulting
 * origin still passes strict URL parsing.
 */
export function requestSiteOrigin(request: Pick<Request, "url" | "headers">): string | null {
  // 浏览器实际访问的源最优先：重定向是「导航」而非规范身份，必须回到用户所在的域。
  if (trustedProxyHops() > 0) {
    const observed = observedRequestOrigin(request);
    if (observed) return observed;
  }

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

/**
 * 从请求还原「浏览器实际看到的源」。X-Forwarded-Host 缺失时退回 Host 头：
 * cloudflared 等隧道不会改写也不发送 X-Forwarded-Host，但会原样保留公网
 * Host 并附上 X-Forwarded-Proto。仅在 TRUST_PROXY_HOPS>0 时应当被使用。
 */
function observedRequestOrigin(request: Pick<Request, "url" | "headers">): string | null {
  const forwardedHost = lastForwardedValue(request.headers.get("x-forwarded-host"));
  const rawHost = request.headers.get("host")?.trim() || "";
  // 端口保留：nginx 惯用的 `proxy_set_header X-Forwarded-Host $host` 会剥掉
  // 非标准端口（$host 不含 port）。当 XFH 缺端口、且其域名与原始 Host 一致时，
  // 改用带端口的 Host 还原完整对外源（如 https://blog.example.com:8443）；
  // 域名不一致说明代理刻意改写了对外主机名，仍以 XFH 为准。
  let host = forwardedHost || rawHost;
  if (forwardedHost && rawHost && !/[[\]]/.test(forwardedHost) && !forwardedHost.includes(":")) {
    const forwardedParts = splitAuthority(forwardedHost);
    const originalParts = splitAuthority(rawHost);
    if (
      forwardedParts &&
      originalParts &&
      forwardedParts.hostname === originalParts.hostname &&
      !forwardedParts.port &&
      originalParts.port
    ) {
      host = rawHost;
    }
  }
  if (!host) return null;
  const requestOrigin = parseHttpOrigin(request.url);
  const requestProtocol = requestOrigin ? new URL(requestOrigin).protocol.slice(0, -1) : "";
  const proto = (lastForwardedValue(request.headers.get("x-forwarded-proto")) || requestProtocol).toLowerCase();
  if (proto !== "http" && proto !== "https") return null;
  return parseHttpOrigin(`${proto}://${host}`);
}

/** 解析 host[:port] 权威字段；拒绝带用户信息/路径等畸形值（IPv6 含冒号由调用方排除）。 */
function splitAuthority(value: string): { hostname: string; port: string } | null {
  try {
    const parsed = new URL(`http://${value}`);
    if (
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return { hostname: parsed.hostname.toLowerCase(), port: parsed.port };
  } catch {
    return null;
  }
}

export function trustedForwardedSiteOrigin(
  request: Pick<Request, "url" | "headers">
): string | null {
  if (trustedProxyHops() <= 0) return null;
  // 与 requestSiteOrigin 同口径（XFH → Host 兜底），供跨来源校验把
  // 隧道域名加入同源白名单。
  return observedRequestOrigin(request);
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
