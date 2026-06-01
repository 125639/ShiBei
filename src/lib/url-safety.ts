import { lookup } from "node:dns/promises";
import net from "node:net";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type SafeFetchOptions = {
  fetcher?: typeof fetch;
  maxRedirects?: number;
};

/**
 * Validate that an outbound fetch / browser-navigation URL points at a public
 * target, not at the host's own loopback / private network / cloud metadata.
 *
 * Used by scrapers (scrape.ts, scrape-audience.ts) and any other code path
 * that pulls a user/admin-supplied URL through Playwright or fetch — those are
 * the SSRF doorways into Redis (localhost:6379), the DB, cloud metadata
 * (169.254.169.254), and internal services on private subnets.
 *
 * The synchronous helper blocks malformed URLs and private IP literals. Use
 * assertSafeResolvedFetchUrl before real network requests so hostnames that
 * resolve to private IPs are rejected as well.
 */
export function assertSafeFetchUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`URL 解析失败：${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`不允许的协议：${url.protocol}（仅允许 http/https）`);
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (!host || host === "localhost" || host.endsWith(".localhost")) {
    throw new Error(`不允许的目标：${host || "(空)"}`);
  }

  if (net.isIP(host)) {
    assertPublicIpAddress(host);
  }

  return url;
}

export async function assertSafeResolvedFetchUrl(rawUrl: string): Promise<URL> {
  const url = assertSafeFetchUrl(rawUrl);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return url;

  const addresses = await lookup(host, { all: true, verbatim: false });
  if (!addresses.length) {
    throw new Error(`目标域名无法解析：${host}`);
  }
  for (const address of addresses) {
    assertPublicIpAddress(address.address);
  }
  return url;
}

export async function isSafeResolvedFetchUrl(rawUrl: string): Promise<boolean> {
  try {
    await assertSafeResolvedFetchUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}

export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {}
): Promise<Response> {
  const fetcher = options.fetcher || fetch;
  const maxRedirects = options.maxRedirects ?? 5;
  let current = await assertSafeResolvedFetchUrl(rawUrl);
  let requestInit = { ...init };

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const response = await fetcher(current.toString(), {
      ...requestInit,
      redirect: "manual"
    });

    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    if (redirects >= maxRedirects) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("重定向次数过多，已拒绝继续请求");
    }

    const next = new URL(location, current);
    current = await assertSafeResolvedFetchUrl(next.toString());
    await response.body?.cancel().catch(() => undefined);

    if (response.status === 303 && requestInit.method && requestInit.method.toUpperCase() !== "HEAD") {
      requestInit = { ...requestInit, method: "GET", body: undefined };
    }
  }

  throw new Error("重定向次数过多，已拒绝继续请求");
}

export function isHttpUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function assertPublicIpAddress(address: string) {
  const ipVersion = net.isIP(address);
  if (ipVersion === 4) {
    const parts = address.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      throw new Error(`目标 IPv4 无效，已拒绝：${address}`);
    }
    const [a, b] = parts;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    ) {
      throw new Error(`目标 IP 在内网/保留段，已拒绝：${address}`);
    }
    return;
  }

  if (ipVersion === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::" || normalized === "::1") {
      throw new Error(`目标 IPv6 在回环段，已拒绝：${address}`);
    }
    if (normalized.startsWith("fe80:") || /^f[cd][0-9a-f]{2}:/i.test(normalized)) {
      throw new Error(`目标 IPv6 在内网/链路本地段，已拒绝：${address}`);
    }
    const mappedV4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedV4) assertPublicIpAddress(mappedV4[1]);
    return;
  }

  throw new Error(`目标 IP 无效，已拒绝：${address}`);
}
