import { NextResponse } from "next/server";
import { backendFetchInitForConfig, getResolvedSyncConfig } from "@/lib/sync/config";

/**
 * 前端模式下，把 /api/public/* 中需要 AI 的请求透明转发到 backend。
 * 保留方法、headers（除 host / content-length / cookie / authorization 等）、body。
 *
 * Next.js 13/14/15 的 Request 是 Web Fetch API Request；body 是 ReadableStream。
 * 我们直接把它通过 fetch 转发，无需在前端解 body —— 这样可以原样传 multipart/json/text。
 */
export async function proxyToBackend(request: Request, targetPath: string): Promise<Response> {
  const cfg = await getResolvedSyncConfig();
  if (!cfg.backendUrl) {
    return NextResponse.json(
      { error: "frontend 模式但未配置 backend 地址" },
      { status: 503 }
    );
  }

  const incomingUrl = new URL(request.url);
  const targetUrl = `${cfg.backendUrl}${targetPath}${incomingUrl.search}`;

  // 复制 headers，剔除会让目标失败的 hop-by-hop / 鉴权字段。
  const forwardHeaders = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lower = key.toLowerCase();
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "content-length" ||
      lower === "cookie" ||
      lower === "authorization" ||
      lower === "x-forwarded-for" ||
      lower === "x-forwarded-host" ||
      lower === "x-forwarded-proto"
    ) {
      continue;
    }
    forwardHeaders.set(key, value);
  }

  // 用共享密钥作为统一鉴权。
  const init = backendFetchInitForConfig(cfg, {
    method: request.method,
    headers: forwardHeaders,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    // @ts-expect-error: Node fetch 在转发流时需要 duplex
    duplex: "half",
  });

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, init);
  } catch (err) {
    return NextResponse.json(
      { error: `代理到 backend 失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  // 透传响应
  const respHeaders = new Headers();
  for (const [key, value] of upstream.headers.entries()) {
    const lower = key.toLowerCase();
    if (lower === "transfer-encoding" || lower === "connection" || lower === "content-encoding") continue;
    respHeaders.set(key, value);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}
