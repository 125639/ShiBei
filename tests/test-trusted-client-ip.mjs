import assert from "node:assert/strict";
import test from "node:test";
import {
  describeProxyTrustRisk,
  isLoopbackBindHost,
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

test("loopback bind detection only accepts addresses clients cannot reach directly", () => {
  assert.equal(isLoopbackBindHost("127.0.0.1"), true);
  assert.equal(isLoopbackBindHost("127.1.2.3"), true);
  assert.equal(isLoopbackBindHost("::1"), true);
  assert.equal(isLoopbackBindHost("localhost"), true);
  assert.equal(isLoopbackBindHost("0.0.0.0"), false);
  assert.equal(isLoopbackBindHost("192.168.1.10"), false);
  assert.equal(isLoopbackBindHost("::"), false);
  assert.equal(isLoopbackBindHost(undefined), false);
});

test("trusting forwarding headers while listening on a reachable address is flagged", () => {
  // 这正是仓库里出现过的组合：.env 写 TRUST_PROXY_HOPS=1，进程却监听 0.0.0.0
  assert.ok(describeProxyTrustRisk({ trustedProxyHops: 1, hostname: "0.0.0.0" }));
  assert.ok(describeProxyTrustRisk({ trustedProxyHops: 2, hostname: "192.168.1.10" }));
  // 自洽的两种形态都不该告警
  assert.equal(describeProxyTrustRisk({ trustedProxyHops: 1, hostname: "127.0.0.1" }), null);
  assert.equal(describeProxyTrustRisk({ trustedProxyHops: 0, hostname: "0.0.0.0" }), null);
  assert.equal(describeProxyTrustRisk({ trustedProxyHops: "garbage", hostname: "0.0.0.0" }), null);
});
