import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { redirectTo } from "@/lib/redirect";
import { rejectCrossOriginMutation } from "@/lib/request-origin";
import { backendFetchInitForConfig, getResolvedSyncConfig } from "@/lib/sync/config";
import { markBackendReachable, probeBackend } from "@/lib/sync/auto-sync";

// POST /api/admin/sync/test
//
// /admin/sync 页面的「测试连接」按钮：管理员保存完 backend 入口和共享密钥后，
// 立刻得到"能不能连上"的答案，而不是等 sync-worker 的下一轮。
// 由服务端向 backend 发 probe（10s 超时），结果通过 query string 带回页面。
export async function POST(request: Request) {
  const denied = rejectCrossOriginMutation(request);
  if (denied) return denied;
  await requireAdmin();

  const cfg = await getResolvedSyncConfig();
  const wantsJson = (request.headers.get("accept") || "").includes("application/json");

  if (!cfg.backendUrl || !cfg.syncToken) {
    if (wantsJson) {
      return NextResponse.json({ kind: "unconfigured" }, { status: 400 });
    }
    return redirectTo("/admin/sync?test=unconfigured", request);
  }

  const outcome = await probeBackend(cfg);

  if (outcome.kind === "legacy") {
    // 老版本 backend 没有 probe 路由。用一次"未来时间点"的增量导出验证鉴权：
    // since 在未来 → 命中 0 篇文章，ZIP 极小，但 401/网络错误照样暴露。
    const futureSince = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    const legacyUrl = `${cfg.backendUrl}/api/admin/sync/export?since=${encodeURIComponent(futureSince)}`;
    const startedAt = Date.now();
    try {
      const res = await fetch(
        legacyUrl,
        backendFetchInitForConfig(cfg, { method: "GET", signal: AbortSignal.timeout(15_000) })
      );
      const latencyMs = Date.now() - startedAt;
      await res.arrayBuffer().catch(() => undefined);
      if (res.ok) {
        await markBackendReachable();
        if (wantsJson) return NextResponse.json({ kind: "legacy", latencyMs });
        return redirectTo(`/admin/sync?test=legacy&latency=${latencyMs}`, request);
      }
      const detail = `backend 返回 ${res.status}`;
      if (wantsJson) return NextResponse.json({ kind: "error", latencyMs, message: detail }, { status: 502 });
      return redirectTo(`/admin/sync?test=fail&detail=${encodeURIComponent(detail)}`, request);
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const detail =
        err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
          ? "连接超时（15s 无响应）"
          : err instanceof Error
            ? err.message
            : String(err);
      if (wantsJson) return NextResponse.json({ kind: "error", latencyMs, message: detail }, { status: 502 });
      return redirectTo(`/admin/sync?test=fail&detail=${encodeURIComponent(detail.slice(0, 180))}`, request);
    }
  }

  if (outcome.kind === "ok") {
    if (wantsJson) return NextResponse.json(outcome);
    return redirectTo(`/admin/sync?test=ok&latency=${outcome.latencyMs}`, request);
  }

  if (wantsJson) return NextResponse.json(outcome, { status: 502 });
  return redirectTo(
    `/admin/sync?test=fail&detail=${encodeURIComponent(outcome.message.slice(0, 180))}`,
    request
  );
}
