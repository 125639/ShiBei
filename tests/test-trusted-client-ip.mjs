import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSocketIp,
  parseTrustedProxyHops,
  resolveTrustedClientIp
} from "../scripts/trusted-next-server.mjs";

test("direct deployments ignore spoofed forwarding headers", () => {
  assert.equal(resolveTrustedClientIp({
    socketAddress: "::ffff:203.0.113.20",
    forwardedFor: "198.51.100.1",
    trustedProxyHops: 0
  }), "203.0.113.20");
});

test("a fixed trusted proxy hop count selects the rightmost untrusted address", () => {
  assert.equal(resolveTrustedClientIp({
    socketAddress: "10.0.0.3",
    forwardedFor: "198.51.100.9, 10.0.0.2",
    trustedProxyHops: 2
  }), "198.51.100.9");
  assert.equal(resolveTrustedClientIp({
    socketAddress: "10.0.0.3",
    forwardedFor: "198.51.100.9, 10.0.0.2",
    trustedProxyHops: 1
  }), "10.0.0.2");
});

test("invalid or incomplete proxy input fails closed to the TCP peer", () => {
  assert.equal(parseTrustedProxyHops("garbage"), 0);
  assert.equal(parseTrustedProxyHops("-1"), 0);
  assert.equal(parseTrustedProxyHops("999"), 10);
  assert.equal(resolveTrustedClientIp({
    socketAddress: "192.0.2.10%eth0",
    forwardedFor: "attacker-value",
    trustedProxyHops: 1
  }), "192.0.2.10");
  assert.equal(normalizeSocketIp("not-an-ip"), null);
});
