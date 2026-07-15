// 应用部署模式 — 由 APP_MODE 环境变量控制。
//
// - "full":单机自给自足，前端展示 + 后端抓取/总结/视频下载/调度都在同一个进程。
// - "frontend":只做文章/视频展示，自身不抓取、不调用 AI。AI 公开接口（站内助手 / 翻译 / 写作助手）
//                透明转发到后端。文章通过自动拉取或手动 ZIP 导入获得。
// - "backend":只做后端工作（BullMQ worker、抓取、总结、视频下载），把成品通过 ZIP 暴露给前端。
//                公开页保留以便健康检查/同步访问，但不面向终端用户。

export type AppMode = "frontend" | "backend" | "full";

export type AppCapability = "local-worker";

// Keep the deployment-mode capability matrix in one server-safe module. UI,
// route guards and the Next proxy all consume this instead of maintaining
// subtly different "frontend" allow/deny lists.
export function appModeSupports(mode: AppMode, capability: AppCapability): boolean {
  if (capability === "local-worker") return mode === "backend" || mode === "full";
  return false;
}

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

export function hasLocalWorker(mode: AppMode = getAppMode()): boolean {
  return appModeSupports(mode, "local-worker");
}

// Pages that present local crawling/AI/job controls, and APIs which either
// enqueue BullMQ work or configure those local-only workflows. A frontend
// deployment has no worker to consume them, so exposing any of these would
// create jobs that remain QUEUED forever or settings which can never take
// effect. Prefix matching intentionally covers nested pages/routes.
export const LOCAL_WORKER_ADMIN_PAGE_PREFIXES = [
  "/admin/ai",
  "/admin/jobs",
  "/admin/sources",
  "/admin/modules",
  "/admin/auto-curation"
] as const;

export const LOCAL_WORKER_ADMIN_API_PREFIXES = [
  "/api/admin/ai-admin",
  "/api/admin/run",
  "/api/admin/sources",
  "/api/admin/modules",
  "/api/admin/content-topics",
  "/api/admin/settings/auto-curation",
  "/api/admin/settings/model-routing",
  "/api/admin/content-styles",
  "/api/admin/model-configs",
  "/api/admin/posts/assist",
  "/api/admin/posts/bulk-repair"
] as const;

function matchesPathPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function requiresLocalWorker(pathname: string): boolean {
  return [...LOCAL_WORKER_ADMIN_PAGE_PREFIXES, ...LOCAL_WORKER_ADMIN_API_PREFIXES]
    .some((prefix) => matchesPathPrefix(pathname, prefix));
}

export function isPathAvailableInAppMode(pathname: string, mode: AppMode = getAppMode()): boolean {
  return hasLocalWorker(mode) || !requiresLocalWorker(pathname);
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
