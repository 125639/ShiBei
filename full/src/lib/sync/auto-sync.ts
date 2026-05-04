import { prisma } from "@/lib/prisma";
import { backendFetchInitForConfig, getResolvedSyncConfig } from "@/lib/sync/config";
import { importFromZip, type ImportResult } from "./import";

/**
 * 前端模式下，从 backend 拉一份增量 ZIP 并 import 到本地。
 *
 * 流程：
 *   1. 读 SyncState.lastImportedAt 作为增量起点（向前重叠 60 秒，避免边界丢内容）
 *   2. GET <backend>/api/admin/sync/export?since=...   带共享密钥
 *   3. 把响应 ZIP 给 importFromZip 处理
 *
 * 失败会写到 SyncState.lastError，调用方应捕获异常并展示给管理员。
 */

// 两端时钟可能存在轻微漂移（NTP 偏差、容器启动顺序等），把 since 向前回退一段时间，
// 用 import 端按 updatedAt 大小做去重，保证边界 1 分钟内的更新不会被吞掉。
const SINCE_OVERLAP_MS = 60 * 1000;

export async function runAutoSync(): Promise<{
  attempted: boolean;
  reason?: string;
  result?: ImportResult;
  bytes?: number;
}> {
  const cfg = await getResolvedSyncConfig();
  if (!cfg.backendUrl) {
    return { attempted: false, reason: "backend 入口未配置" };
  }
  if (!cfg.syncToken) {
    return { attempted: false, reason: "共享密钥未配置" };
  }

  const state = await prisma.syncState
    .findUnique({ where: { id: "sync" } })
    .catch(() => null);

  let since = "";
  if (state?.lastImportedAt) {
    const overlapped = new Date(state.lastImportedAt.getTime() - SINCE_OVERLAP_MS);
    since = overlapped.toISOString();
  }

  const url = `${cfg.backendUrl}/api/admin/sync/export${since ? `?since=${encodeURIComponent(since)}` : ""}`;

  let response: Response;
  try {
    response = await fetch(url, backendFetchInitForConfig(cfg, { method: "GET" }));
  } catch (err) {
    const msg = `连接 backend 失败: ${err instanceof Error ? err.message : String(err)}`;
    await writeError(msg);
    throw new Error(msg);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const msg = `backend 返回 ${response.status}: ${text.slice(0, 200)}`;
    await writeError(msg);
    throw new Error(msg);
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (contentType && !contentType.includes("zip") && !contentType.includes("octet-stream")) {
    // backend 把 401/500 之类的 JSON 也可能 200 返回，提前拦下避免 parseSyncZip 抛
    // 一个不友好的「ZIP 缺少 manifest」。
    const text = await response.text().catch(() => "");
    const msg = `backend 返回了非 ZIP 响应（content-type=${contentType}），前 200 字节: ${text.slice(0, 200)}`;
    await writeError(msg);
    throw new Error(msg);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length === 0) {
    await writeError(null);
    return { attempted: true, bytes: 0 };
  }

  const result = await importFromZip(buffer);
  return { attempted: true, result, bytes: buffer.length };
}

async function writeError(msg: string | null) {
  try {
    await prisma.syncState.upsert({
      where: { id: "sync" },
      create: { id: "sync", lastError: msg, updatedAt: new Date() },
      update: { lastError: msg },
    });
  } catch {
    // ignore — 写错误日志失败时只能放弃
  }
}
