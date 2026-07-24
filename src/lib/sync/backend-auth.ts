/**
 * 后端公开 API 鉴权助手。
 *
 * 背景：
 *   当 APP_MODE=backend 时，本进程会同时承担：
 *     1) 给前端服务器拉 ZIP（/api/admin/sync/export）
 *     2) 接收前端代理过来的 AI 调用（/api/public/assistant、/translate、/writing/assist）
 *
 *   两台服务器若不在同一私网（即用户场景：不同云厂商的 VPS），后端 IP 必然要暴露
 *   到公网才能被前端访问。中间件已经把面向终端用户的页面（/posts 等）重定向到
 *   /admin；但是 `/api/public/*` 仍是开放的——这是为了让前端"以代理身份"调用。
 *
 *   如果不加任何鉴权，等于把模型 Key 接到了公网开放代理，任何人扫到 IP 都能调
 *   `/api/public/assistant` 让你的 AI Key 出账。所以 backend 模式下这几个路由
 *   必须要求 `Authorization: Bearer ${SYNC_TOKEN}`，与 frontend 的 proxyToBackend
 *   行为一致。
 *
 *   full / frontend 模式不会走这个分支，行为不变。
 */

import { NextResponse } from "next/server";
import { isBackend } from "@/lib/app-mode";
import { getResolvedSyncConfig } from "@/lib/sync/config";
import { bearerTokenMatches } from "@/lib/sync/token";

/**
 * 校验对 backend 公开端点的访问。frontend / full 模式直接放行，
 * backend 模式下要求 Authorization: Bearer ${SYNC_TOKEN}。
 *
 * @returns null 表示通过；否则是要返回的 401/503 响应。
 */
export async function ensureBackendCallerAllowed(request: Request): Promise<Response | null> {
  if (!isBackend()) return null;

  const cfg = await getResolvedSyncConfig();
  if (!cfg.syncToken) {
    return NextResponse.json(
      {
        error:
          "backend 模式但未配置共享密钥（SYNC_TOKEN）。" +
          "请在 /admin/sync 保存密钥，或通过环境变量 SYNC_TOKEN 设置。",
      },
      { status: 503 }
    );
  }

  const auth = request.headers.get("authorization") || "";
  if (bearerTokenMatches(auth, cfg.syncToken)) return null;

  return NextResponse.json(
    { error: "未授权：本路由仅允许已配置共享密钥的前端代理调用。" },
    { status: 401 }
  );
}

/**
 * 公开 AI 端点的限流身份。必须在 ensureBackendCallerAllowed 放行之后调用。
 *
 * backend 模式下走到这里的调用方必然是持有共享密钥的前端代理（无密钥请求已被
 * 401 拦下）；此时采信代理转发的原始访客 IP，否则全站访客在 backend 侧都折叠
 * 成前端出口 IP 的同一个限流桶，一个访客就能打满所有人共享的 per-IP 额度。
 * full / frontend 模式下该头不可信（任何人都能直接设置），返回 undefined
 * 让限流退回本机解析的客户端 IP。
 */
export function publicAiRateLimitIdentity(request: Request): string | undefined {
  if (!isBackend()) return undefined;
  const forwarded = request.headers.get("x-shibei-proxy-client-ip")?.trim();
  if (!forwarded) return undefined;
  return `proxied:${forwarded.slice(0, 80)}`;
}
