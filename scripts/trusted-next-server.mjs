import { createServer } from "node:http";
import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import next from "next";

export function normalizeSocketIp(value) {
  if (typeof value !== "string") return null;
  let candidate = value.trim();
  if (candidate.startsWith("::ffff:")) candidate = candidate.slice(7);
  const zone = candidate.indexOf("%");
  if (zone >= 0) candidate = candidate.slice(0, zone);
  return isIP(candidate) ? candidate : null;
}

export function parseTrustedProxyHops(value) {
  if (!/^(?:0|[1-9]\d*)$/.test(String(value ?? ""))) return 0;
  return Math.min(10, Number(value));
}

/**
 * Default: ignore every caller-controlled forwarding header and use the TCP peer.
 * Operators behind an exclusive trusted reverse proxy may opt into a fixed hop count.
 * For XFF `client, proxy-a` and socket proxy-b, TRUST_PROXY_HOPS=2 selects client.
 */
export function resolveTrustedClientIp({ socketAddress, forwardedFor, trustedProxyHops = 0 }) {
  const socketIp = normalizeSocketIp(socketAddress) || "unknown";
  const hops = parseTrustedProxyHops(trustedProxyHops);
  if (hops === 0) return socketIp;

  const chain = String(forwardedFor || "")
    .split(",")
    .map(normalizeSocketIp)
    .filter(Boolean);
  if (chain.length < hops) return socketIp;
  return chain[chain.length - hops];
}

export async function startTrustedNextServer() {
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  // Docker injects HOSTNAME=<container-id>; it is not a listen address and would
  // make the 127.0.0.1 healthcheck fail. Only our explicit variable may override.
  const hostname = process.env.APP_HOST || "0.0.0.0";
  const trustedProxyHops = parseTrustedProxyHops(process.env.TRUST_PROXY_HOPS || "0");
  // Private per-process authenticator: application code does not trust the internal
  // IP header unless the wrapper also signed it. Running `next start` directly or
  // sending the private header from the network therefore fails closed.
  const internalIpSecret = randomBytes(32).toString("hex");
  process.env.SHIBEI_INTERNAL_IP_SECRET = internalIpSecret;
  const app = next({ dev: false, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  if (trustedProxyHops > 0) {
    console.warn(
      `[server] TRUST_PROXY_HOPS=${trustedProxyHops}; only expose this port through exactly that many trusted proxies.`
    );
  } else {
    console.log("[server] forwarding headers are untrusted; quotas use the TCP peer address");
  }

  const server = createServer((request, response) => {
    // Always overwrite the private header. A direct client can send the same name,
    // but its value never reaches application code.
    const clientIp = resolveTrustedClientIp({
      socketAddress: request.socket.remoteAddress,
      forwardedFor: request.headers["x-forwarded-for"],
      trustedProxyHops
    });
    request.headers["x-shibei-client-ip"] = clientIp;
    request.headers["x-shibei-client-ip-signature"] = createHmac("sha256", internalIpSecret)
      .update(clientIp, "utf8")
      .digest("hex");
    handle(request, response).catch((error) => {
      console.error("[server] request failed", error);
      if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("Internal Server Error");
    });
  });

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, () => resolveListen());
  });
  console.log(`[server] ready on http://${hostname}:${port}`);
  return server;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  startTrustedNextServer()
    .then((server) => {
      // 容器里本进程就是 PID 1：内核不会替 PID 1 执行默认信号动作，不装处理
      // 器的话 docker stop 要干等满 10s 宽限期再被 SIGKILL（npm 当 PID 1 的
      // 年代同样如此）。收到停止信号：停止接新连接、掐掉空闲 keep-alive，
      // 在途请求最多再给 5s 排干，然后退出——别拖住滚动更新。
      let shuttingDown = false;
      const shutdown = (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`[server] ${signal} received, shutting down`);
        server.close(() => process.exit(0));
        server.closeIdleConnections();
        setTimeout(() => process.exit(0), 5000).unref();
      };
      process.on("SIGTERM", () => shutdown("SIGTERM"));
      process.on("SIGINT", () => shutdown("SIGINT"));
    })
    .catch((error) => {
      console.error("[server] startup failed", error);
      process.exit(1);
    });
}
