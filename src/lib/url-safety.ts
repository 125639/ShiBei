/**
 * Validate that an outbound fetch / browser-navigation URL points at a public
 * target, not at the host's own loopback / private network / cloud metadata.
 *
 * Used by scrapers (scrape.ts, scrape-audience.ts) and any other code path
 * that pulls a user/admin-supplied URL through Playwright or fetch — those are
 * the SSRF doorways into Redis (localhost:6379), the DB, cloud metadata
 * (169.254.169.254), and internal services on private subnets.
 *
 * Note: This blocks IP literals only. Hostnames that resolve to private IPs
 * via DNS will still slip through; full mitigation requires DNS resolution +
 * IP check at fetch time. This is a baseline that closes the easy bypasses.
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

  // IPv4 字面量
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (
      a === 0 ||                         // 0.0.0.0/8 reserved
      a === 10 ||                        // 10.0.0.0/8 private
      a === 127 ||                       // 127.0.0.0/8 loopback
      (a === 169 && b === 254) ||        // 169.254.0.0/16 link-local（含云 metadata）
      (a === 172 && b >= 16 && b <= 31) ||// 172.16.0.0/12 private
      (a === 192 && b === 168) ||        // 192.168.0.0/16 private
      a >= 224                           // 224.0.0.0/4 multicast、240.0.0.0/4 reserved
    ) {
      throw new Error(`目标 IP 在内网/保留段，已拒绝：${host}`);
    }
  }

  // IPv6 字面量：屏蔽 ::、::1、fc00::/7（unique-local）、fe80::/10（link-local）
  if (host.includes(":")) {
    if (host === "::" || host === "::1") {
      throw new Error(`目标 IPv6 在回环段，已拒绝：${host}`);
    }
    if (/^f[cd][0-9a-f]{2}(?::|$)/.test(host) || /^fe[89ab][0-9a-f]?(?::|$)/.test(host)) {
      throw new Error(`目标 IPv6 在内网/链路本地段，已拒绝：${host}`);
    }
  }

  return url;
}
