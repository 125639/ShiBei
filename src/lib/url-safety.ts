import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import net from "node:net";
import type { LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type SafeFetchOptions = {
  fetcher?: typeof fetch;
  maxRedirects?: number;
};

export type ResolvedFetchTarget = {
  url: URL;
  addresses: LookupAddress[];
};

const MAX_PINNED_DISPATCHERS = 32;
const dispatcherState = globalThis as typeof globalThis & {
  shibeiPinnedDispatchers?: Map<string, Agent>;
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
  return (await resolveSafeFetchTarget(rawUrl)).url;
}

/**
 * Resolve once, reject the complete answer set when any address is not public,
 * and return that exact snapshot to the caller.  Low-level egress proxies use
 * the returned addresses directly instead of asking DNS a second time.
 */
export async function resolveSafeFetchTarget(rawUrl: string): Promise<ResolvedFetchTarget> {
  const url = assertSafeFetchUrl(rawUrl);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    return { url, addresses: [{ address: host, family: net.isIP(host) as 4 | 6 }] };
  }

  const addresses = await lookup(host, { all: true, verbatim: false });
  if (!addresses.length) {
    throw new Error(`目标域名无法解析：${host}`);
  }
  for (const address of addresses) {
    assertPublicIpAddress(address.address);
  }
  return { url, addresses };
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
  const maxRedirects = options.maxRedirects ?? 5;
  let current = await resolveSafeFetchTarget(rawUrl);
  let requestInit = { ...init };

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const response = options.fetcher
      ? await options.fetcher(current.url.toString(), { ...requestInit, redirect: "manual" })
      : await undiciFetch(current.url, {
          ...requestInit,
          redirect: "manual",
          dispatcher: pinnedDispatcher(current)
        } as Parameters<typeof undiciFetch>[1]) as unknown as Response;

    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    if (redirects >= maxRedirects) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("重定向次数过多，已拒绝继续请求");
    }

    const next = new URL(location, current.url);
    current = await resolveSafeFetchTarget(next.toString());
    await response.body?.cancel().catch(() => undefined);

    if (response.status === 303 && requestInit.method && requestInit.method.toUpperCase() !== "HEAD") {
      requestInit = { ...requestInit, method: "GET", body: undefined };
    }
  }

  throw new Error("重定向次数过多，已拒绝继续请求");
}

/**
 * Bind the socket lookup to the exact public addresses that passed validation.
 * Without this, fetch performs a second DNS lookup and a rebinding domain can
 * switch from a public address to loopback/private metadata between checks.
 */
function pinnedDispatcher(target: ResolvedFetchTarget): Agent {
  const key = `${target.url.origin}|${target.addresses.map((item) => `${item.family}:${item.address}`).join(",")}`;
  const dispatchers = dispatcherState.shibeiPinnedDispatchers ||= new Map<string, Agent>();
  const cached = dispatchers.get(key);
  if (cached) {
    dispatchers.delete(key);
    dispatchers.set(key, cached);
    return cached;
  }

  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    const normalized = typeof options === "number" ? { family: options } : options;
    const requestedFamily = normalized?.family;
    const candidates = requestedFamily === 4 || requestedFamily === 6
      ? target.addresses.filter((item) => item.family === requestedFamily)
      : target.addresses;
    const selected = candidates[0] || target.addresses[0];
    if (normalized && "all" in normalized && normalized.all) {
      (callback as (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void)(null, candidates);
      return;
    }
    (callback as (error: NodeJS.ErrnoException | null, address: string, family: number) => void)(
      null,
      selected.address,
      selected.family
    );
  };

  const agent = new Agent({ connect: { lookup: pinnedLookup } });
  dispatchers.set(key, agent);
  if (dispatchers.size > MAX_PINNED_DISPATCHERS) {
    const oldestKey = dispatchers.keys().next().value as string | undefined;
    const oldest = oldestKey ? dispatchers.get(oldestKey) : undefined;
    if (oldestKey) dispatchers.delete(oldestKey);
    if (oldest) void oldest.close().catch(() => undefined);
  }
  return agent;
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
    const [a, b, c] = parts;
    if (
      a === 0 ||
      a === 10 ||
      // RFC 6598 carrier-grade NAT. Cloud providers also expose metadata
      // services inside this range (for example 100.100.100.200).
      (a === 100 && b >= 64 && b <= 127) ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      // IETF protocol assignments and documentation/reserved networks are not
      // normal public fetch targets. Denying the whole special blocks avoids
      // provider-specific control planes hiding behind individual addresses.
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
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
    // IPv4-mapped/compatible literals are canonicalized by URL/net in several
    // textual forms. Validate the embedded IPv4 with the same deny list first.
    const mappedV4 = normalized.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedV4) {
      assertPublicIpAddress(mappedV4[1]);
      return;
    }
    const mappedHex = normalized.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1], 16);
      const low = Number.parseInt(mappedHex[2], 16);
      assertPublicIpAddress([
        (high >>> 8) & 0xff,
        high & 0xff,
        (low >>> 8) & 0xff,
        low & 0xff
      ].join("."));
      return;
    }

    // Public IPv6 global unicast is currently 2000::/3. An allow boundary is
    // safer than chasing every internal/reserved block (fc00/fd00, fe80/fec0,
    // ff00 multicast, discard-only prefixes, and future special-use ranges).
    const groups = normalized.split(":");
    const firstGroup = Number.parseInt(groups[0] || "0", 16);
    const secondGroup = Number.parseInt(groups[1] || "0", 16);
    if (firstGroup < 0x2000 || firstGroup > 0x3fff) {
      throw new Error(`目标 IPv6 不属于公网单播地址，已拒绝：${address}`);
    }

    // Special-use blocks embedded inside 2000::/3: IETF protocol assignments,
    // benchmarking/ORCHID, documentation, deprecated 6to4, and the newer 3fff
    // documentation allocation. None is a normal public HTTP destination.
    if (
      (firstGroup === 0x2001 && secondGroup <= 0x01ff) ||
      (firstGroup === 0x2001 && secondGroup === 0x0db8) ||
      firstGroup === 0x2002 ||
      (firstGroup === 0x3fff && secondGroup <= 0x0fff)
    ) {
      throw new Error(`目标 IPv6 在协议/保留段，已拒绝：${address}`);
    }
    return;
  }

  throw new Error(`目标 IP 无效，已拒绝：${address}`);
}
