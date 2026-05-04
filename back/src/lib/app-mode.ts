// 应用部署模式 — 由 APP_MODE 环境变量控制。
//
// - "full":单机自给自足，前端展示 + 后端抓取/总结/视频下载/调度都在同一个进程。
// - "frontend":只做文章/视频展示，自身不抓取、不调用 AI。AI 公开接口（站内助手 / 翻译 / 写作助手）
//                透明转发到后端。文章通过自动拉取或手动 ZIP 导入获得。
// - "backend":只做后端工作（BullMQ worker、抓取、总结、视频下载），把成品通过 ZIP 暴露给前端。
//                公开页保留以便健康检查/同步访问，但不面向终端用户。

export type AppMode = "frontend" | "backend" | "full";

export function getAppMode(): AppMode {
  const raw = (process.env.APP_MODE || "full").trim().toLowerCase();
  if (raw === "frontend" || raw === "backend" || raw === "full") return raw;
  return "full";
}

export function isFrontend(): boolean {
  return getAppMode() === "frontend";
}

export function isBackend(): boolean {
  return getAppMode() === "backend";
}

export function isFull(): boolean {
  return getAppMode() === "full";
}

export type SyncMode = "auto" | "manual";

export type SyncConfig = {
  mode: SyncMode;
  backendUrl: string;
  syncToken: string;
  intervalMinutes: number;
};

export function getSyncConfig(): SyncConfig {
  const mode = ((process.env.SYNC_MODE || "auto").trim().toLowerCase() === "manual"
    ? "manual"
    : "auto") as SyncMode;
  const backendUrl = (process.env.BACKEND_API_URL || "").trim().replace(/\/+$/, "");
  const syncToken = (process.env.SYNC_TOKEN || "").trim();
  const intervalRaw = Number(process.env.SYNC_INTERVAL_MINUTES || "15");
  const intervalMinutes = Number.isFinite(intervalRaw) && intervalRaw > 0 ? Math.floor(intervalRaw) : 15;
  return { mode, backendUrl, syncToken, intervalMinutes };
}

// Helper: frontend 模式下，访问 backend 的 fetch 配置。
export function backendFetchInit(extra?: RequestInit): RequestInit {
  const { syncToken } = getSyncConfig();
  const headers = new Headers(extra?.headers || {});
  if (syncToken) headers.set("Authorization", `Bearer ${syncToken}`);
  return { ...extra, headers };
}
