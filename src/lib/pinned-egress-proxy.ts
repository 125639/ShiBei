import { randomBytes, timingSafeEqual } from "node:crypto";
import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import net, { type Socket } from "node:net";
import type { LookupAddress } from "node:dns";
import { resolveSafeFetchTarget } from "./url-safety";

const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;
const DEFAULT_IDLE_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_CONNECTIONS = 48;

export type PinnedEgressProxy = {
  serverUrl: string;
  username: string;
  password: string;
  close: () => Promise<void>;
};

type PinnedEgressProxyOptions = {
  /** Empty means any public hostname. Values match the host and its subdomains. */
  allowedHostSuffixes?: readonly string[];
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxConnections?: number;
};

type ValidatedProxyTarget = {
  hostname: string;
  port: number;
  addresses: LookupAddress[];
  url: URL;
};

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

export function hostMatchesAllowedSuffixes(hostname: string, suffixes: readonly string[]) {
  const host = normalizeHostname(hostname);
  return suffixes.some((rawSuffix) => {
    const suffix = normalizeHostname(rawSuffix).replace(/^\./, "");
    return Boolean(suffix) && (host === suffix || host.endsWith(`.${suffix}`));
  });
}

async function validateProxyTarget(
  rawUrl: string,
  expectedProtocol: "http:" | "https:",
  expectedPort: number,
  allowedHostSuffixes: readonly string[]
): Promise<ValidatedProxyTarget> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== expectedProtocol || parsed.username || parsed.password) {
    throw new Error("代理目标协议或凭据不受支持");
  }
  const port = parsed.port ? Number(parsed.port) : expectedPort;
  if (port !== expectedPort) {
    throw new Error("代理仅允许标准 HTTP/HTTPS 端口");
  }
  const hostname = normalizeHostname(parsed.hostname);
  if (allowedHostSuffixes.length && !hostMatchesAllowedSuffixes(hostname, allowedHostSuffixes)) {
    throw new Error("代理目标不在受信主机范围内");
  }
  const target = await resolveSafeFetchTarget(parsed.toString());
  return { hostname, port, addresses: target.addresses, url: target.url };
}

function removeHopByHopHeaders(headers: IncomingHttpHeaders) {
  const clean: Record<string, string | string[]> = {};
  const blocked = new Set([
    "connection",
    "content-length",
    "host",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade"
  ]);
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || blocked.has(name.toLowerCase())) continue;
    clean[name] = value;
  }
  return clean;
}

function safeResponseHeaders(headers: IncomingHttpHeaders) {
  const clean: Record<string, string | string[]> = {};
  const blocked = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade"
  ]);
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || blocked.has(name.toLowerCase())) continue;
    clean[name] = value;
  }
  return clean;
}

function responseText(res: ServerResponse, status: number, message: string) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, {
    "cache-control": "no-store",
    connection: "close",
    "content-type": "text/plain; charset=utf-8"
  });
  res.end(message);
}

function socketResponse(socket: Socket, status: number, message: string) {
  if (socket.destroyed) return;
  socket.end(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
  );
}

function socketProxyAuthRequired(socket: Socket) {
  if (socket.destroyed) return;
  socket.end(
    "HTTP/1.1 407 Proxy Authentication Required\r\n" +
    'Proxy-Authenticate: Basic realm="ShiBei egress"\r\n' +
    "Connection: close\r\nContent-Length: 0\r\n\r\n"
  );
}

function constantTimeEqual(left: string | undefined, right: string) {
  if (!left) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function connectPinned(
  addresses: readonly LookupAddress[],
  port: number,
  timeoutMs: number
): Promise<Socket> {
  let lastError: Error | null = null;
  for (const address of addresses) {
    try {
      const socket = await new Promise<Socket>((resolve, reject) => {
        const pending = net.createConnection({
          host: address.address,
          family: address.family,
          port
        });
        const onError = (error: Error) => {
          pending.destroy();
          reject(error);
        };
        pending.setTimeout(timeoutMs, () => onError(new Error("出站连接超时")));
        pending.once("error", onError);
        pending.once("connect", () => {
          pending.off("error", onError);
          pending.setTimeout(0);
          resolve(pending);
        });
      });
      return socket;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError || new Error("无法连接受信公网目标");
}

/**
 * A small authenticated forward proxy. DNS is resolved and validated here,
 * and sockets connect to the validated IP snapshot. Chromium/yt-dlp never get
 * a chance to resolve the destination independently, closing DNS-rebinding
 * and validation-to-connect TOCTOU gaps.
 */
export async function startPinnedEgressProxy(
  options: PinnedEgressProxyOptions = {}
): Promise<PinnedEgressProxy> {
  const allowedHostSuffixes = (options.allowedHostSuffixes || []).map((item) => normalizeHostname(item));
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const username = "shibei";
  const password = randomBytes(24).toString("base64url");
  const expectedAuthorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const activeSockets = new Set<Socket>();

  const authorized = (req: IncomingMessage) =>
    constantTimeEqual(req.headers["proxy-authorization"], expectedAuthorization);

  const server = http.createServer(async (req, res) => {
    if (!authorized(req)) {
      res.writeHead(407, {
        connection: "close",
        "proxy-authenticate": 'Basic realm="ShiBei egress"'
      });
      res.end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      responseText(res, 405, "代理仅允许只读请求");
      return;
    }

    let target: ValidatedProxyTarget;
    try {
      target = await validateProxyTarget(req.url || "", "http:", 80, allowedHostSuffixes);
    } catch {
      responseText(res, 403, "目标已被出站安全策略拒绝");
      return;
    }

    const headers = removeHopByHopHeaders(req.headers);
    headers.host = target.url.host;
    let settled = false;
    let lastError: Error | null = null;
    // 取消回调挂在循环外：逐地址重试时不能在 req/res 上累积一次性监听器。
    let cancelActiveUpstream: (() => void) | null = null;
    const cancelUpstream = () => cancelActiveUpstream?.();
    req.once("aborted", cancelUpstream);
    res.once("close", cancelUpstream);
    for (const address of target.addresses) {
      if (settled || res.destroyed) break;
      await new Promise<void>((resolve) => {
        const upstream = http.request({
          agent: false,
          family: address.family,
          headers,
          host: address.address,
          method: req.method,
          path: `${target.url.pathname}${target.url.search}`,
          port: 80,
          timeout: connectTimeoutMs
        });
        cancelActiveUpstream = () => upstream.destroy();
        upstream.once("socket", (socket) => {
          activeSockets.add(socket);
          socket.once("close", () => activeSockets.delete(socket));
        });
        upstream.once("response", (upstreamResponse) => {
          settled = true;
          res.writeHead(
            upstreamResponse.statusCode || 502,
            upstreamResponse.statusMessage,
            safeResponseHeaders(upstreamResponse.headers)
          );
          upstreamResponse.pipe(res);
          // 上游在响应中途出错时必须终结下游响应；否则客户端会一直挂到
          // 自身超时（HTTP 路径没有空闲超时兜底）。
          upstreamResponse.once("error", () => res.destroy());
          resolve();
        });
        upstream.once("timeout", () => upstream.destroy(new Error("出站请求超时")));
        upstream.once("error", (error) => {
          lastError = error;
          resolve();
        });
        upstream.end();
      });
    }
    if (!settled) {
      responseText(res, 502, lastError ? "受信公网目标连接失败" : "代理请求失败");
    }
  });

  server.on("connect", async (req, clientSocket, head) => {
    // Node's HTTP typings expose CONNECT sockets as Duplex, while the concrete
    // server implementation supplies net.Socket.
    const downstream = clientSocket as Socket;
    downstream.pause();
    if (!authorized(req)) {
      socketProxyAuthRequired(downstream);
      return;
    }

    let target: ValidatedProxyTarget;
    try {
      target = await validateProxyTarget(`https://${req.url || ""}/`, "https:", 443, allowedHostSuffixes);
    } catch {
      socketResponse(downstream, 403, "Forbidden");
      return;
    }

    let upstream: Socket;
    try {
      upstream = await connectPinned(target.addresses, target.port, connectTimeoutMs);
    } catch {
      socketResponse(downstream, 502, "Bad Gateway");
      return;
    }

    activeSockets.add(downstream);
    activeSockets.add(upstream);
    const forget = (socket: Socket) => activeSockets.delete(socket);
    downstream.once("close", () => forget(downstream));
    upstream.once("close", () => forget(upstream));
    downstream.once("error", () => upstream.destroy());
    upstream.once("error", () => downstream.destroy());
    downstream.setTimeout(idleTimeoutMs, () => downstream.destroy());
    upstream.setTimeout(idleTimeoutMs, () => upstream.destroy());
    downstream.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    downstream.pipe(upstream);
    upstream.pipe(downstream);
    downstream.resume();
  });

  server.on("upgrade", (_req, socket) => socket.destroy());
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("connection", (socket) => {
    activeSockets.add(socket);
    socket.once("close", () => activeSockets.delete(socket));
  });
  server.maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("无法启动本地出站安全代理");
  }

  let closed = false;
  return {
    serverUrl: `http://127.0.0.1:${address.port}`,
    username,
    password,
    close: async () => {
      if (closed) return;
      closed = true;
      for (const socket of activeSockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}
