// 前端模式专用的轻量同步进程。
//
// 与 src/worker/index.ts(BullMQ + Playwright + Redis 重型 worker)不同,这里仅:
//   - 周期性读取网页端/环境变量配置后调 runAutoSync()
//   - 没有 Redis、没有队列依赖
//   - 失败有指数退避(60s → 120s → 240s 上限到 intervalMinutes 配置)
//
// 启动方式:`npm run sync-worker`(由 scripts/start-app.sh 在 frontend 模式下并发拉起)。

import { runAutoSync } from "../lib/sync/auto-sync";
import { getAppMode } from "../lib/app-mode";
import { getResolvedSyncConfig } from "../lib/sync/config";

const FAILURE_BASE_DELAY_MS = 60 * 1000;
const FAILURE_MAX_DELAY_MS = 30 * 60 * 1000;

let consecutiveFailures = 0;

async function main() {
  const mode = getAppMode();

  if (mode !== "frontend" && mode !== "full") {
    console.log(`[sync-worker] APP_MODE=${mode} 不需要 sync-worker,退出。`);
    return;
  }
  console.log("[sync-worker] 启动:等待 /admin/sync 或 .env 中的同步配置。");

  while (true) {
    const delayMs = await tick();
    await sleep(delayMs);
  }
}

async function tick(): Promise<number> {
  const at = new Date().toISOString();
  let cfg;
  try {
    cfg = await getResolvedSyncConfig();
  } catch (err) {
    console.error(`[sync-worker ${at}] 读取同步配置失败,60 秒后重试:`, err);
    return 60 * 1000;
  }
  const intervalMs = cfg.intervalMinutes * 60 * 1000;

  if (cfg.mode !== "auto") {
    // 手动模式时静默,但每 intervalMs 还是重读一次配置以便切换回 auto 时迅速生效。
    return intervalMs;
  }
  if (!cfg.backendUrl || !cfg.syncToken) {
    if (consecutiveFailures === 0) {
      console.log("[sync-worker] backend 地址或共享密钥未配置,60 秒后重试。可在 /admin/sync 网页端保存。");
    }
    consecutiveFailures = Math.min(consecutiveFailures + 1, 6);
    return Math.min(FAILURE_BASE_DELAY_MS * Math.pow(2, consecutiveFailures - 1), FAILURE_MAX_DELAY_MS);
  }

  try {
    const res = await runAutoSync();
    consecutiveFailures = 0;
    if (!res.attempted) {
      console.log(`[sync-worker ${at}] 跳过: ${res.reason}`);
      return intervalMs;
    }
    if (res.bytes === 0) {
      console.log(`[sync-worker ${at}] 同步完成:无新数据`);
      return intervalMs;
    }
    console.log(
      `[sync-worker ${at}] 同步完成:${res.bytes} 字节,导入 ${res.result?.postsUpserted || 0} 篇 / ${res.result?.videosUpserted || 0} 个视频,跳过 ${res.result?.postsSkipped || 0}/${res.result?.videosSkipped || 0}` +
        (res.result?.errors.length ? `,${res.result.errors.length} 条错误` : "")
    );
    return intervalMs;
  } catch (err) {
    consecutiveFailures = Math.min(consecutiveFailures + 1, 6);
    const backoff = Math.min(FAILURE_BASE_DELAY_MS * Math.pow(2, consecutiveFailures - 1), FAILURE_MAX_DELAY_MS);
    console.error(
      `[sync-worker ${at}] 同步失败(连续第 ${consecutiveFailures} 次,${Math.round(backoff / 1000)}s 后重试):`,
      err instanceof Error ? err.message : err
    );
    return backoff;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("[sync-worker] 启动失败:", err);
  process.exit(1);
});
