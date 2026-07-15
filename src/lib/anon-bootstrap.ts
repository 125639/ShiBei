import { createHmac } from "node:crypto";
import { getAuthSecret } from "./auth";

export const ANON_BOOTSTRAP_HEADER = "x-shibei-anon-bootstrap";
export const ANON_BOOTSTRAP_HEADER_VALUE = "1";
export const ANON_CREATION_SEED_HEADER = "x-shibei-anon-seed";
const ANON_BOOTSTRAP_DOMAIN = "anon-bootstrap:v1\0";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BootstrapRequestOptions = {
  production?: boolean;
  siteUrl?: string;
};

export type BootstrapRequestRejection = {
  status: 400 | 403 | 415;
  error: string;
};

/** seed 永不直接成为 bearer identity；服务端密钥 HMAC 后才写入 HttpOnly cookie。 */
export function deriveAnonIdFromBootstrapSeed(
  seed: string,
  secret: Uint8Array = getAuthSecret()
): string {
  const digest = createHmac("sha256", Buffer.from(secret))
    .update(ANON_BOOTSTRAP_DOMAIN, "utf8")
    .update(seed.trim().toLowerCase(), "utf8")
    .digest("base64url");
  return `anon_v1_${digest}`;
}

/**
 * Creation requests echo the seed from their immediately preceding bootstrap.
 * It is not a bearer identity; it only lets a cookie-less request derive the
 * same server-secret HMAC identity if the shared cookie jar was cleared between
 * bootstrap and the write.
 */
export function anonCreationSeedFromRequest(request: Request): string | null {
  const seed = request.headers.get(ANON_CREATION_SEED_HEADER)?.trim() || "";
  return UUID_PATTERN.test(seed) ? seed.toLowerCase() : null;
}

/**
 * Bootstrap 必须是非简单同源 JSON 请求。生产环境额外要求 Origin 与配置站点、
 * 请求 URL 或可信转发 host 之一严格同源；任何 cross-site Fetch Metadata 都拒绝。
 */
export function anonBootstrapRequestRejection(
  request: Request,
  options: BootstrapRequestOptions = {}
): BootstrapRequestRejection | null {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return { status: 415, error: "匿名身份初始化只接受 application/json" };
  }
  if (request.headers.get(ANON_BOOTSTRAP_HEADER) !== ANON_BOOTSTRAP_HEADER_VALUE) {
    return { status: 403, error: "缺少匿名身份初始化确认头" };
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite === "cross-site") {
    return { status: 403, error: "拒绝跨站匿名身份初始化" };
  }

  const production = options.production ?? process.env.NODE_ENV === "production";
  if (!production) return null;

  const rawOrigin = request.headers.get("origin");
  const origin = parseHttpOrigin(rawOrigin);
  if (!origin) {
    return { status: 403, error: "生产环境匿名身份初始化必须携带有效 Origin" };
  }

  const trusted = trustedRequestOrigins(request, options.siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL);
  if (!trusted.has(origin)) {
    return { status: 403, error: "匿名身份初始化 Origin 不受信任" };
  }
  return null;
}

function parseHttpOrigin(raw: string | null | undefined): string | null {
  if (!raw || raw === "null") return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function trustedRequestOrigins(request: Request, siteUrl?: string): Set<string> {
  const trusted = new Set<string>();
  const configured = parseHttpOrigin(siteUrl);
  if (configured) trusted.add(configured);

  try {
    const requestUrl = new URL(request.url);
    if (requestUrl.protocol === "http:" || requestUrl.protocol === "https:") {
      trusted.add(requestUrl.origin);
    }
  } catch {
    // Request constructed by Next always has an absolute URL; fail closed below if not.
  }

  const forwardedHost = lastHeaderValue(request.headers.get("x-forwarded-host"));
  const host = forwardedHost || lastHeaderValue(request.headers.get("host"));
  const forwardedProto = lastHeaderValue(request.headers.get("x-forwarded-proto"));
  let requestProtocol = "";
  try {
    requestProtocol = new URL(request.url).protocol.replace(":", "");
  } catch {
    // ignored
  }
  const proto = (forwardedProto || requestProtocol).toLowerCase();
  if (host && (proto === "http" || proto === "https") && isSafeHost(host)) {
    const forwardedOrigin = parseHttpOrigin(`${proto}://${host}`);
    if (forwardedOrigin) trusted.add(forwardedOrigin);
  }
  return trusted;
}

function lastHeaderValue(raw: string | null): string {
  return raw?.split(",").at(-1)?.trim() || "";
}

function isSafeHost(host: string): boolean {
  return host.length <= 255 && /^[a-zA-Z0-9.:[\]-]+$/.test(host);
}
