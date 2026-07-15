import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Production requests receive this header only from scripts/trusted-next-server.mjs,
 * which overwrites any caller value from the TCP peer/trusted proxy chain.
 */
export function trustedClientIp(request: Request): string {
  const injected = request.headers.get("x-shibei-client-ip")?.trim();
  const signature = request.headers.get("x-shibei-client-ip-signature")?.trim();
  const secret = process.env.SHIBEI_INTERNAL_IP_SECRET;
  if (injected && signature && secret) {
    const expected = createHmac("sha256", secret).update(injected, "utf8").digest();
    const supplied = /^[a-f0-9]{64}$/i.test(signature) ? Buffer.from(signature, "hex") : Buffer.alloc(0);
    if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) {
      return injected.slice(0, 80);
    }
  }

  // Unit tests and `next dev` do not run through the production wrapper. Keep the
  // familiar headers there, but production fails closed instead of trusting input.
  if (process.env.NODE_ENV === "production") return "unknown";
  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
    "unknown"
  ).slice(0, 80);
}
