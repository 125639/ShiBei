import { prisma } from "@/lib/prisma";
import {
  backendFetchInitForConfig,
  getResolvedSyncConfig,
  type ResolvedSyncConfig,
} from "@/lib/sync/config";
import { importFromZip, type ImportResult } from "./import";
import { MAX_SYNC_ZIP_BYTES, readResponseBufferWithLimit } from "./limits";

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

// probe 是纯元数据请求，正常应在几百毫秒内返回；10s 还没回来就当不可达，
// 让 sync-worker 走快速重试而不是吊死一整轮。
export const PROBE_TIMEOUT_MS = 10 * 1000;

// ZIP 拉取的整体超时（含响应体）。默认 10 分钟，足够慢链路传输 SYNC_MAX_ZIP_MB；
// 主要目的是兜底"连接悬挂不结束"，可用 SYNC_PULL_TIMEOUT_MS 覆盖（30s–60min）。
const PULL_TIMEOUT_MS = (() => {
  const raw = Number(process.env.SYNC_PULL_TIMEOUT_MS || "");
  if (!Number.isFinite(raw) || raw <= 0) return 10 * 60 * 1000;
  return Math.min(Math.max(Math.floor(raw), 30 * 1000), 60 * 60 * 1000);
})();

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/** 对 SyncState 单行做 best-effort 局部更新；观测字段写失败不阻塞同步本身。 */
async function patchSyncState(
  fields: Partial<{
    lastError: string | null;
    lastAttemptAt: Date;
    backendReachableAt: Date;
    workerAliveAt: Date;
  }>
) {
  try {
    await prisma.syncState.upsert({
      where: { id: "sync" },
      create: { id: "sync", ...fields },
      update: fields,
    });
  } catch {
    // ignore — 观测信息写不进去时只能放弃
  }
}

/** sync-worker 每轮 tick 调用，让 /admin/sync 能判断进程是否存活。 */
export async function touchSyncWorkerHeartbeat() {
  await patchSyncState({ workerAliveAt: new Date() });
}

/** 记录一次"确认打通了 backend"（probe 成功或拉取拿到 2xx）。 */
export async function markBackendReachable() {
  await patchSyncState({ backendReachableAt: new Date() });
}

/** 把连接类错误写进 SyncState.lastError（页面「上次错误」一栏）。 */
export async function recordSyncError(msg: string | null) {
  await patchSyncState({ lastError: msg });
}

export type BackendProbeOutcome =
  | {
      kind: "ok";
      latencyMs: number;
      latestContentAt: Date | null;
      serverTime: Date | null;
      schemaVersion: number | null;
      appMode: string | null;
      publishedCount: number | null;
    }
  // 老版本 backend 没有 /api/admin/sync/probe 路由（404/405）——不是故障，
  // 调用方应退回"按固定间隔拉取"的老行为。
  | { kind: "legacy"; latencyMs: number }
  | { kind: "error"; latencyMs: number; message: string; status?: number };

function parseDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 轻量探活：问 backend「你在吗？最新内容改到什么时候了？」。
 * 不下载 ZIP，开销只有一次小 JSON 请求，可以放心每分钟调用。
 * 永不 throw——网络错误也折叠成 { kind: "error" }。
 */
export async function probeBackend(preloaded?: ResolvedSyncConfig): Promise<BackendProbeOutcome> {
  let cfg: ResolvedSyncConfig;
  try {
    cfg = preloaded ?? (await getResolvedSyncConfig());
  } catch (err) {
    return {
      kind: "error",
      latencyMs: 0,
      message: `读取同步配置失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!cfg.backendUrl || !cfg.syncToken) {
    return { kind: "error", latencyMs: 0, message: "backend 入口或共享密钥未配置" };
  }

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(
      `${cfg.backendUrl}/api/admin/sync/probe`,
      backendFetchInitForConfig(cfg, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
    );
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const message = isAbortError(err)
      ? `连接超时（${Math.round(PROBE_TIMEOUT_MS / 1000)}s 无响应）`
      : err instanceof Error
        ? err.message
        : String(err);
    return { kind: "error", latencyMs, message: `探测 backend 失败: ${message}` };
  }
  const latencyMs = Date.now() - startedAt;

  if (response.status === 404 || response.status === 405) {
    await response.text().catch(() => "");
    return { kind: "legacy", latencyMs };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      kind: "error",
      latencyMs,
      status: response.status,
      message: `backend 返回 ${response.status}: ${text.slice(0, 160)}`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { kind: "error", latencyMs, message: "probe 返回了无法解析的响应（上游可能不是 ShiBei backend）" };
  }
  const data = payload as {
    ok?: unknown;
    latestContentAt?: unknown;
    serverTime?: unknown;
    schemaVersion?: unknown;
    appMode?: unknown;
    publishedCount?: unknown;
  } | null;
  if (!data || data.ok !== true) {
    return { kind: "error", latencyMs, message: "probe 响应缺少 ok 标记" };
  }

  await markBackendReachable();
  const schemaVersion = Number(data.schemaVersion);
  const publishedCount = Number(data.publishedCount);
  return {
    kind: "ok",
    latencyMs,
    latestContentAt: parseDateOrNull(data.latestContentAt),
    serverTime: parseDateOrNull(data.serverTime),
    schemaVersion: Number.isFinite(schemaVersion) ? schemaVersion : null,
    appMode: typeof data.appMode === "string" ? data.appMode : null,
    publishedCount: Number.isFinite(publishedCount) ? publishedCount : null,
  };
}

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

  await patchSyncState({ lastAttemptAt: new Date() });

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
    response = await fetch(
      url,
      backendFetchInitForConfig(cfg, {
        method: "GET",
        signal: AbortSignal.timeout(PULL_TIMEOUT_MS),
      })
    );
  } catch (err) {
    const detail = isAbortError(err)
      ? `拉取超时（${Math.round(PULL_TIMEOUT_MS / 1000)}s，含响应体传输）`
      : err instanceof Error
        ? err.message
        : String(err);
    const msg = `连接 backend 失败: ${detail}`;
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
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_SYNC_ZIP_BYTES) {
    const msg = `backend 返回的 ZIP 超过 ${Math.round(MAX_SYNC_ZIP_BYTES / 1024 / 1024)}MB，请改用手动轻量同步`;
    await writeError(msg);
    throw new Error(msg);
  }

  // 走到这里说明 backend 已给出 2xx 响应——连通性成立。
  await markBackendReachable();

  let buffer: Buffer;
  try {
    buffer = await readResponseBufferWithLimit(response, MAX_SYNC_ZIP_BYTES);
  } catch (err) {
    const detail = isAbortError(err)
      ? `拉取超时（${Math.round(PULL_TIMEOUT_MS / 1000)}s，响应体传输中断）`
      : err instanceof Error
        ? err.message
        : String(err);
    const msg = `下载同步包失败: ${detail}`;
    await writeError(msg);
    throw new Error(msg);
  }
  if (buffer.length === 0) {
    await writeError(null);
    return { attempted: true, bytes: 0 };
  }

  const result = await importFromZip(buffer);
  return { attempted: true, result, bytes: buffer.length };
}

async function writeError(msg: string | null) {
  await patchSyncState({ lastError: msg });
}
