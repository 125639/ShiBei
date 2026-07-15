import { isIP } from "node:net";

export class BackendUrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendUrlValidationError";
  }
}

/**
 * Normalize the frontend -> backend service origin without weakening the
 * transport boundary around SYNC_TOKEN. Public hosts require HTTPS. Plain HTTP
 * is limited to loopback, private literal addresses, and single-label Docker /
 * LAN service names; paths, credentials, query strings and fragments are not
 * accepted because every sync endpoint is appended by the application.
 */
export function assertBackendUrl(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BackendUrlValidationError("Backend 入口不是有效 URL");
  }

  if (
    !url.hostname ||
    url.username ||
    url.password ||
    url.port === "0" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new BackendUrlValidationError("Backend 入口必须是不含凭据、路径、查询或片段的站点源");
  }

  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && isPrivateBackendHost(url.hostname)) return url.origin;

  throw new BackendUrlValidationError(
    "公网 Backend 入口必须使用 HTTPS；HTTP 仅允许回环、私网 IP 或单标签内网服务名"
  );
}

/** Invalid persisted/env values fail closed and behave as not configured. */
export function normalizeBackendUrl(value: unknown): string {
  try {
    return assertBackendUrl(value);
  } catch {
    return "";
  }
}

function isPrivateBackendHost(rawHostname: string): boolean {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;

  const version = isIP(hostname);
  if (version === 4) {
    const [a, b] = hostname.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  if (version === 6) {
    return hostname === "::1" || /^f[cd][0-9a-f]{2}(?::|$)/.test(hostname);
  }

  // Docker Compose service names and conventional LAN aliases are normally
  // single-label. Dotted/public DNS names must use HTTPS.
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname);
}
