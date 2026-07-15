/**
 * Mint a short-lived admin session JWT for driving the local production app
 * during e2e verification. Reads AUTH_SECRET from env, admin user id +
 * tokenVersion from argv.
 *
 * Usage: AUTH_SECRET=... node scripts/e2e/mint-admin-session.mjs <userId> <tokenVersion>
 */
import { SignJWT } from "jose";

const [userId, tokenVersionRaw] = process.argv.slice(2);
const secret = process.env.AUTH_SECRET;
if (!userId || !secret) {
  console.error("usage: AUTH_SECRET=... node mint-admin-session.mjs <userId> <tokenVersion>");
  process.exit(1);
}
const token = await new SignJWT({ userId, ver: Number(tokenVersionRaw || 0) })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("2h")
  .sign(new TextEncoder().encode(secret));
console.log(token);
