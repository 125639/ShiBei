import { createServer } from "node:http";
import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// @next/env 是 CommonJS，没有具名 ESM 导出；必须走 default 再解构。
import nextEnv from "@next/env";
import next from "next";

const { loadEnvConfig } = nextEnv;

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

/** 只有回环地址能保证「客户端无法绕过反代直连本进程」。 */
export function isLoopbackBindHost(host) {
  const normalized = String(host ?? "").trim().toLowerCase();
  if (normalized === "localhost") return true;
  const ip = normalizeSocketIp(normalized);
  if (!ip) return false;
  return ip === "::1" || ip.startsWith("127.");
}

/**
 * TRUST_PROXY_HOPS>0 意味着「X-Forwarded-For 由可信反代写入」。这个前提只有在
 * 客户端无法直连本端口时才成立。监听在非回环地址时两者同时为真就是配置错误：
 * 任何能直连的客户端自带 XFF 即可伪造身份，所有按 IP 的配额（匿名 AI 成稿的
 * 终身额度、评论、埋点、注册）全部失效。
 *
 * 返回 null 表示配置自洽；否则返回应当打印的告警文本。
 * 不直接拒绝启动：容器部署里进程监听 0.0.0.0、由 compose 的端口映射
 * (`${APP_BIND_IP}:${APP_PORT}:3000`) 限制暴露面，是完全合法的形态。
 */
export function describeProxyTrustRisk({ trustedProxyHops, hostname }) {
  if (parseTrustedProxyHops(trustedProxyHops) <= 0) return null;
  if (isLoopbackBindHost(hostname)) return null;
  return [
    `[server] ⚠ 配置风险：TRUST_PROXY_HOPS=${trustedProxyHops} 但本进程监听 ${hostname}（非回环）。`,
    "[server]   若该端口可被客户端直连，任何人自带 X-Forwarded-For 即可伪造来源 IP，",
    "[server]   使所有按 IP 的配额失效（匿名 AI 成稿终身额度、评论、注册、访问统计）。",
    "[server]   · 公网 IP 直连、前面没有反代  → 设 TRUST_PROXY_HOPS=0",
    "[server]   · 同机反代/隧道             → 设 APP_BIND_IP=127.0.0.1（或 APP_HOST）",
    "[server]   · 容器内监听 0.0.0.0        → 确认 compose 端口映射已限制暴露面，可忽略本提示"
  ].join("\n");
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
  // 必须先于任何 process.env 读取。Next 只在 app.prepare() 内部加载 .env，
  // 而 PORT / TRUST_PROXY_HOPS / APP_HOST 在那之前就要用：不先自己加载的话，
  // 只写在 .env 里（没 export 到进程环境）的值对本包装器不可见，
  // 而请求期的应用代码（lib/site-url.ts 等）却能读到——同一个变量两处读出不同结果。
  const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  loadEnvConfig(projectDir, false);

  const port = Number.parseInt(process.env.PORT || process.env.APP_PORT || "3000", 10);
  // Docker injects HOSTNAME=<container-id>; it is not a listen address and would
  // make the 127.0.0.1 healthcheck fail. Only our explicit variables may override.
  // APP_BIND_IP 是 .env / init.sh / docker-compose 里一直在用的名字；此前本文件
  // 只认 APP_HOST，导致裸机部署时按文档把 APP_BIND_IP 改成 127.0.0.1 完全无效
  // ——进程照旧监听 0.0.0.0，而 README 把它写成启用 TRUST_PROXY_HOPS=1 的必要前提。
  const hostname = process.env.APP_HOST || process.env.APP_BIND_IP || "0.0.0.0";
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

  const trustRisk = describeProxyTrustRisk({ trustedProxyHops, hostname });
  if (trustRisk) console.warn(trustRisk);

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
  // 启动预热：Node 懒加载路由模块图，重启后第一个访客原本要为每条路由
  // 支付一次几十 ms~2s 的首次渲染成本。这里自己先把热门公开路由打一遍，
  // 把成本转移到启动阶段（后台执行，不阻塞 ready 返回）。
  warmupRoutes(port).catch(() => {});
  return server;
}

const WARMUP_PATHS = [
  "/", "/posts", "/about", "/settings", "/write",
  "/create", "/account", "/stats", "/community", "/feed.xml"
];

async function warmupRoutes(port) {
  const base = `http://127.0.0.1:${port}`;
  let ok = 0;
  await Promise.allSettled(
    WARMUP_PATHS.map((p) =>
      fetch(base + p, { headers: { "user-agent": "shibei-warmup/1" } })
        .then((res) => {
          // 丢弃 body 但要消费掉以释放连接；异常状态不重试，真实访客来了自然会再填缓存。
          res.body?.cancel().catch(() => {});
          if (res.ok) ok += 1;
        })
        .catch(() => {})
    )
  );
  console.log(`[server] warmup: ${ok}/${WARMUP_PATHS.length} 条路由已预热`);
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
