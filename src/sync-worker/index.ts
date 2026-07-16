// 前端模式专用的轻量同步进程。
//
// 与 src/worker/index.ts(BullMQ + Playwright + Redis 重型 worker)不同,这里没有
// Redis、没有队列依赖,只负责把 backend 的新内容拉到本地。
//
// 2026-07 重写。老版本在"未配置 / 失败 / 成功"之后都盲睡(最长 30 分钟),
// 管理员在 /admin/sync 保存配置后无人唤醒它,于是"总要过十几分钟才建立联系"。
// 现在的节奏:
//   - 每 15s 轮询一次配置(单行 DB 读,开销可忽略)——保存配置后数秒内生效
//   - 连通后每 60s 向 backend 发一次轻量 probe(GET /api/admin/sync/probe),
//     发现新内容立即拉增量 ZIP;老版本 backend 没有该路由时退回按间隔拉取
//   - intervalMinutes 仍然生效:作为无条件增量拉取的对账周期(默认 15 分钟)
//   - 失败退避 60s → 120s → 240s,封顶 5 分钟(原来封顶 30 分钟)
//   - 每轮 tick 写 SyncState.workerAliveAt 心跳,/admin/sync 页面可见进程状态
//
// 启动方式:`npm run sync-worker`(由 scripts/start-app.sh 在 frontend 模式下拉起并监督)。

import {
  probeBackend,
  recordSyncError,
  runAutoSync,
  touchSyncWorkerHeartbeat,
} from "../lib/sync/auto-sync";
import { getAppMode } from "../lib/app-mode";
import { getResolvedSyncConfig, type ResolvedSyncConfig } from "../lib/sync/config";
import { SYNC_SCHEMA_VERSION } from "../lib/sync/types";
import { prisma } from "../lib/prisma";
import { notifyPublicContentRevalidation } from "../worker/public-cache";

// sync-worker 与 Next 应用同容器,内部缓存刷新默认打本机;完整版 worker
// 独立容器时仍以 SHIBEI_INTERNAL_APP_URL 为准。
const INTERNAL_APP_URL = (process.env.SHIBEI_INTERNAL_APP_URL || "").trim() || "http://127.0.0.1:3000";

const TICK_MS = 15 * 1000;

// probe 频率:默认 60s,SYNC_PROBE_SECONDS 可覆盖(15–3600)。
const PROBE_INTERVAL_MS = (() => {
  const raw = Number(process.env.SYNC_PROBE_SECONDS || "");
  if (!Number.isFinite(raw) || raw <= 0) return 60 * 1000;
  return Math.min(Math.max(Math.floor(raw), 15), 3600) * 1000;
})();

// 老后端(无 probe 路由)每 30 分钟重试一次探测,这样对端升级后无需重启本进程。
const PROBE_SUPPORT_RECHECK_MS = 30 * 60 * 1000;

const FAILURE_BASE_DELAY_MS = 60 * 1000;
const FAILURE_MAX_DELAY_MS = 5 * 60 * 1000;

let consecutiveFailures = 0;
let nextRetryAt = 0; // 失败退避期的结束时刻(0 = 无退避)
let lastProbeAt = 0;
let lastPullAt = 0; // 上次成功拉取(进程内;重启后归零 → 启动即拉一次)
let probeSupported: boolean | null = null; // null = 还不知道对端是否支持 probe
let probeSupportCheckedAt = 0;
let lastFingerprint: string | null = null;
let lastIdleLogKey = ""; // 空闲状态只在变化时打一行日志,避免刷屏
let lastErrorWasConnection = false;
let schemaMismatchActive = false;

function configFingerprint(cfg: ResolvedSyncConfig): string {
  return JSON.stringify([cfg.mode, cfg.backendUrl, cfg.syncToken ? "token-set" : "", cfg.intervalMinutes]);
}

function logIdleOnce(key: string, message: string) {
  if (lastIdleLogKey === key) return;
  lastIdleLogKey = key;
  console.log(`[sync-worker] ${message}`);
}

async function registerFailure(message: string) {
  consecutiveFailures = Math.min(consecutiveFailures + 1, 6);
  const backoff = Math.min(
    FAILURE_BASE_DELAY_MS * 2 ** (consecutiveFailures - 1),
    FAILURE_MAX_DELAY_MS
  );
  nextRetryAt = Date.now() + backoff;
  console.error(
    `[sync-worker ${new Date().toISOString()}] ${message}(连续第 ${consecutiveFailures} 次失败,${Math.round(backoff / 1000)}s 后重试)`
  );
}

async function getLastImportedAt(): Promise<Date | null> {
  try {
    const state = await prisma.syncState.findUnique({
      where: { id: "sync" },
      select: { lastImportedAt: true },
    });
    return state?.lastImportedAt ?? null;
  } catch {
    return null;
  }
}

async function pullNow(trigger: string, intervalMinutes: number) {
  const at = new Date().toISOString();
  try {
    const res = await runAutoSync();
    consecutiveFailures = 0;
    nextRetryAt = 0;
    lastErrorWasConnection = false;
    lastPullAt = Date.now();
    lastProbeAt = Date.now(); // 刚拉完就是最新状态,没必要立刻再探测
    if (!res.attempted) {
      console.log(`[sync-worker ${at}] 跳过: ${res.reason}`);
      return;
    }
    if (res.bytes === 0) {
      console.log(`[sync-worker ${at}] 同步完成:无新数据(${trigger};下次对账 ${intervalMinutes} 分钟内)`);
      return;
    }
    console.log(
      `[sync-worker ${at}] 同步完成(${trigger}):${res.bytes} 字节,导入 ${res.result?.postsUpserted || 0} 篇 / ${res.result?.videosUpserted || 0} 个视频,跳过 ${res.result?.postsSkipped || 0}/${res.result?.videosSkipped || 0}` +
        (res.result?.errors.length ? `,${res.result.errors.length} 条错误` : "")
    );
    if ((res.result?.postsUpserted || 0) + (res.result?.videosUpserted || 0) > 0) {
      // 导入发生在 Next 进程之外,必须显式通知它失效公开页缓存,
      // 否则新文章已入库但 /posts、首页等仍展示旧缓存直到自然过期;
      // 文章详情页(ISR)按 slug 精准失效。
      await notifyPublicContentRevalidation(
        (res.result?.upsertedPostSlugs || []).slice(0, 90).map((slug) => `/posts/${slug}`),
        { baseUrl: INTERNAL_APP_URL }
      );
    }
  } catch (err) {
    lastErrorWasConnection = true;
    await registerFailure(
      `同步失败: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function tick(): Promise<void> {
  const now = Date.now();
  await touchSyncWorkerHeartbeat();

  let cfg: ResolvedSyncConfig;
  try {
    cfg = await getResolvedSyncConfig();
  } catch (err) {
    logIdleOnce(
      "config-error",
      `读取同步配置失败,${Math.round(TICK_MS / 1000)}s 后重试: ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }

  const fp = configFingerprint(cfg);
  if (fp !== lastFingerprint) {
    if (lastFingerprint !== null) {
      console.log("[sync-worker] 检测到同步配置变更,立即重新评估");
    }
    lastFingerprint = fp;
    consecutiveFailures = 0;
    nextRetryAt = 0;
    lastProbeAt = 0;
    lastPullAt = 0; // 配置变了 → 立刻尝试一轮
    probeSupported = null;
    lastIdleLogKey = "";
  }

  if (cfg.mode !== "auto") {
    logIdleOnce("manual", "手动同步模式:自动拉取暂停(配置每 15 秒复查,切回自动后立即生效)");
    return;
  }
  if (!cfg.backendUrl || !cfg.syncToken) {
    logIdleOnce(
      "unconfigured",
      "backend 地址或共享密钥未配置。可在 /admin/sync 网页端保存,保存后数秒内自动开始同步。"
    );
    return;
  }

  if (now < nextRetryAt) return; // 失败退避期内,静默等待

  const intervalMs = cfg.intervalMinutes * 60 * 1000;
  const intervalDue = now - lastPullAt >= intervalMs; // lastPullAt=0 时恒真:启动/配置变更后立即拉

  if (intervalDue) {
    await pullNow(lastPullAt === 0 ? "启动/配置生效" : "定期对账", cfg.intervalMinutes);
    return;
  }

  // 间隔未到 → 用轻量 probe 看有没有新内容,有就立刻拉。
  if (now - lastProbeAt < PROBE_INTERVAL_MS) return;
  if (probeSupported === false) {
    if (now - probeSupportCheckedAt < PROBE_SUPPORT_RECHECK_MS) return;
    probeSupported = null; // 到点了,重新确认对端是否已升级
  }
  lastProbeAt = now;

  const probe = await probeBackend(cfg);
  if (probe.kind === "legacy") {
    probeSupported = false;
    probeSupportCheckedAt = now;
    console.log(
      `[sync-worker] backend 是旧版本(无 probe 路由),退回每 ${cfg.intervalMinutes} 分钟定期拉取;更新 backend 后可获得分钟级同步`
    );
    return;
  }
  if (probe.kind === "error") {
    lastErrorWasConnection = true;
    await recordSyncError(probe.message);
    await registerFailure(probe.message);
    return;
  }

  probeSupported = true;
  if (consecutiveFailures > 0 || lastErrorWasConnection) {
    console.log(`[sync-worker ${new Date().toISOString()}] backend 恢复可达(${probe.latencyMs}ms)`);
    consecutiveFailures = 0;
    nextRetryAt = 0;
    if (lastErrorWasConnection) {
      // 上次错误是连接类的,连通恢复后清掉,避免页面一直显示陈旧故障。
      await recordSyncError(null);
      lastErrorWasConnection = false;
    }
  }

  if (probe.schemaVersion !== null && probe.schemaVersion !== SYNC_SCHEMA_VERSION) {
    const msg = `两端同步协议版本不一致(本端 ${SYNC_SCHEMA_VERSION},backend ${probe.schemaVersion}),请把较旧的一端更新后自动恢复`;
    logIdleOnce("schema-mismatch", msg);
    if (!schemaMismatchActive) {
      schemaMismatchActive = true;
      await recordSyncError(msg);
    }
    return;
  }
  if (schemaMismatchActive) {
    // 对端已升级到一致版本,清掉之前记录的版本不一致错误。
    schemaMismatchActive = false;
    lastIdleLogKey = "";
    await recordSyncError(null);
  }

  if (!probe.latestContentAt) return; // backend 还没有可同步的内容

  const lastImported = await getLastImportedAt();
  if (lastImported && probe.latestContentAt.getTime() <= lastImported.getTime()) {
    return; // 没有比上次导入水位更新的内容
  }

  await pullNow("探测到新内容", cfg.intervalMinutes);
}

async function main() {
  const mode = getAppMode();

  if (mode !== "frontend" && mode !== "full") {
    console.log(`[sync-worker] APP_MODE=${mode} 不需要 sync-worker,退出。`);
    return;
  }
  console.log(
    `[sync-worker] 启动:配置轮询 ${Math.round(TICK_MS / 1000)}s,probe 间隔 ${Math.round(PROBE_INTERVAL_MS / 1000)}s,失败退避封顶 ${Math.round(FAILURE_MAX_DELAY_MS / 60000)} 分钟。等待 /admin/sync 或 .env 中的同步配置。`
  );

  while (true) {
    try {
      await tick();
    } catch (err) {
      // tick 内部已各自兜错;这里只防御未预料的异常,保证循环不中断。
      console.error("[sync-worker] tick 异常:", err instanceof Error ? err.message : err);
    }
    await sleep(TICK_MS);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("[sync-worker] 启动失败:", err);
  process.exit(1);
});
