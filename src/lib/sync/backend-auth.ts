/**
 * 后端公开 API 鉴权助手。
 *
 * 背景：
 *   当 APP_MODE=backend 时，本进程会同时承担：
 *     1) 给前端服务器拉 ZIP（/api/admin/sync/export）
 *     2) 接收前端代理过来的 AI 调用（/api/public/assistant、/translate、/writing/assist）
 *
 *   两台服务器若不在同一私网（即用户场景：不同云厂商的 VPS），后端 IP 必然要暴露
 *   到公网才能被前端访问。中间件已经把面向终端用户的页面（/news 等）重定向到
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
  if (auth === `Bearer ${cfg.syncToken}`) return null;

  return NextResponse.json(
    { error: "未授权：本路由仅允许已配置共享密钥的前端代理调用。" },
    { status: 401 }
  );
}
