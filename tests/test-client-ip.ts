import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { trustedClientIp } from "../src/lib/client-ip";

test("production only accepts a wrapper-signed internal client address", () => {
  const env = process.env as Record<string, string | undefined>;
  const previousNodeEnv = env.NODE_ENV;
  const previousSecret = env.SHIBEI_INTERNAL_IP_SECRET;
  Object.assign(env, { NODE_ENV: "production", SHIBEI_INTERNAL_IP_SECRET: "unit-secret" });
  try {
    const forged = new Request("https://example.test", {
      headers: {
        "x-shibei-client-ip": "198.51.100.9",
        "x-shibei-client-ip-signature": "0".repeat(64),
        "x-real-ip": "203.0.113.99"
      }
    });
    assert.equal(trustedClientIp(forged), "unknown");

    const ip = "198.51.100.9";
    const signature = createHmac("sha256", "unit-secret").update(ip).digest("hex");
    const signed = new Request("https://example.test", {
      headers: { "x-shibei-client-ip": ip, "x-shibei-client-ip-signature": signature }
    });
    assert.equal(trustedClientIp(signed), ip);
  } finally {
    if (previousNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previousNodeEnv;
    if (previousSecret === undefined) delete env.SHIBEI_INTERNAL_IP_SECRET;
    else env.SHIBEI_INTERNAL_IP_SECRET = previousSecret;
  }
});
