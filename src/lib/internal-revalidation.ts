import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Worker -> Next application cache-invalidation protocol.
 *
 * The authentication secret is never sent over the wire. Both processes derive
 * the same domain-separated HMAC from AUTH_SECRET and sign the exact request
 * body together with a short-lived timestamp.
 */
export const INTERNAL_REVALIDATION_PATH = "/api/internal/revalidate-public";
export const INTERNAL_REVALIDATION_TIMESTAMP_HEADER = "x-shibei-timestamp";
export const INTERNAL_REVALIDATION_SIGNATURE_HEADER = "x-shibei-signature";
export const INTERNAL_REVALIDATION_MAX_AGE_MS = 5 * 60 * 1000;
export const INTERNAL_REVALIDATION_MAX_BODY_BYTES = 24 * 1024;
export const INTERNAL_REVALIDATION_MAX_PATHS = 100;

const SIGNATURE_VERSION = "v1";
const SIGNATURE_CONTEXT = "shibei/internal-public-revalidation/v1";

export type InternalRevalidationVerification =
  | { ok: true }
  | { ok: false; reason: "missing" | "malformed" | "invalid" | "expired" };

export function getInternalRevalidationSecret() {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_SECRET 未配置，无法认证内部缓存刷新请求");
  }
  return secret;
}

export function signInternalRevalidationRequest(input: {
  body: string;
  timestamp: string;
  secret: string;
}) {
  const digest = createHmac("sha256", input.secret)
    .update(signaturePayload(input.timestamp, input.body), "utf8")
    .digest("hex");
  return `${SIGNATURE_VERSION}=${digest}`;
}

export function verifyInternalRevalidationRequest(input: {
  body: string;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  secret: string;
  now?: number;
  maxAgeMs?: number;
}): InternalRevalidationVerification {
  const timestamp = input.timestamp?.trim() || "";
  const signature = input.signature?.trim() || "";
  if (!timestamp || !signature) return { ok: false, reason: "missing" };
  if (!/^\d{13}$/.test(timestamp) || !/^v1=[a-f0-9]{64}$/i.test(signature)) {
    return { ok: false, reason: "malformed" };
  }

  const expected = Buffer.from(
    signInternalRevalidationRequest({ body: input.body, timestamp, secret: input.secret }).slice(3),
    "hex"
  );
  const supplied = Buffer.from(signature.slice(3), "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return { ok: false, reason: "invalid" };
  }

  const requestedAt = Number(timestamp);
  const now = input.now ?? Date.now();
  const maxAgeMs = input.maxAgeMs ?? INTERNAL_REVALIDATION_MAX_AGE_MS;
  // Also reject timestamps too far in the future. A small amount of clock skew
  // is naturally covered by the same symmetric freshness window.
  if (!Number.isSafeInteger(requestedAt) || Math.abs(now - requestedAt) > maxAgeMs) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}

export function normalizePublicRevalidationPath(value: string) {
  const path = value.trim();
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.length > 500 ||
    /[\\?#\u0000-\u001f\u007f]/.test(path)
  ) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (
    decoded.startsWith("//") ||
    /[\\?#\u0000-\u001f\u007f]/.test(decoded) ||
    decoded.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return null;
  }
  return path;
}

export function normalizePublicRevalidationPaths(values: readonly string[]) {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const path = normalizePublicRevalidationPath(value);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

function signaturePayload(timestamp: string, body: string) {
  return `${SIGNATURE_CONTEXT}\nPOST\n${INTERNAL_REVALIDATION_PATH}\n${timestamp}\n${body}`;
}
