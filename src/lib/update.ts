// 网页端一键更新 —— app 侧逻辑。
//
// 两条路径：
//   1) 主路径：同 compose 网络里的 updater 伴车容器（scripts/updater/server.mjs）。
//      走 git fetch 对比本地仓库与 origin，支持私有仓库、无 API 限额，且能真正执行更新。
//   2) 降级路径：updater 没起来时，用 GitHub REST API 对比"正在运行的镜像 commit"
//      （BUILD_COMMIT，构建时烤入）与远端分支最新 commit。只能提示有新版本，
//      无法一键更新（页面上会说明如何启用 updater）。
//
// 三种部署形态（full / backend / frontend）共用本模块；差异只在 compose 里
// updater 服务的 COMPOSE_FILE_NAME / UPDATE_SERVICES 环境变量。

import { getBuildInfo } from "@/lib/build-info";

export type UpdateCommit = {
  sha: string;
  author?: string;
  date?: string;
  subject: string;
};

export type UpdateCheckResult = {
  checkedAt: string;
  // 正在运行的镜像版本（BUILD_COMMIT；dev 环境为 "dev"）
  runningCommit: string;
  builtAt: string | null;
  branch: string | null;
  remoteCommit: string | null;
  // 仓库 HEAD（仅 updater 路径有；已 pull 未重建时与 runningCommit 不同）
  repoCommit: string | null;
  behind: number | null;
  commits: UpdateCommit[];
  hasUpdate: boolean;
  updaterAvailable: boolean;
  source: "updater" | "github" | "none";
  error: string | null;
};

export type UpdaterStatus = {
  updaterAvailable: boolean;
  running: boolean;
  phase: string;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
  error: string | null;
  log: string[];
  repo?: { commit: string | null; shortCommit: string | null; branch: string | null; remoteUrl: string | null };
};

function getUpdaterUrl(): string {
  return (process.env.UPDATER_URL || "http://updater:9080").trim().replace(/\/+$/, "");
}

function getUpdaterToken(): string {
  return (process.env.UPDATER_TOKEN || process.env.AUTH_SECRET || "").trim();
}

// GitHub 降级路径的仓库标识。默认指向本项目官方仓库；fork 部署请设 UPDATE_REPO。
function getGithubRepo(): string {
  const raw = (process.env.UPDATE_REPO || "125639/ShiBei").trim();
  return /^[\w.-]+\/[\w.-]+$/.test(raw) ? raw : "125639/ShiBei";
}

function getGithubBranch(): string {
  const raw = (process.env.UPDATE_BRANCH || "main").trim();
  return /^[\w./-]+$/.test(raw) ? raw : "main";
}

async function updaterFetch(path: string, init?: RequestInit, timeoutMs = 15_000): Promise<Response> {
  const token = getUpdaterToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${getUpdaterUrl()}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs)
  });
}

// 短 hash（可能带 -dirty）与全长 sha 的宽松比对。unknown/dev 视为不可比。
function sameCommit(shortish: string | null | undefined, full: string | null | undefined): boolean | null {
  const s = (shortish || "").replace(/-dirty$/, "").trim().toLowerCase();
  const f = (full || "").trim().toLowerCase();
  if (!s || !f || s === "unknown" || s === "dev") return null;
  return f.startsWith(s) || s.startsWith(f);
}

async function checkViaUpdater(): Promise<UpdateCheckResult | null> {
  let res: Response;
  try {
    res = await updaterFetch("/check", { method: "POST" }, 150_000);
  } catch {
    return null; // updater 不可达 → 走降级路径
  }
  const build = getBuildInfo();
  const base: UpdateCheckResult = {
    checkedAt: new Date().toISOString(),
    runningCommit: build.commit,
    builtAt: build.builtAt,
    branch: null,
    remoteCommit: null,
    repoCommit: null,
    behind: null,
    commits: [],
    hasUpdate: false,
    updaterAvailable: true,
    source: "updater",
    error: null
  };
  let data: {
    branch?: string;
    localCommit?: string | null;
    remoteCommit?: string | null;
    behind?: number;
    commits?: UpdateCommit[];
    error?: string;
  };
  try {
    data = await res.json();
  } catch {
    return { ...base, error: `updater 响应异常（HTTP ${res.status}）` };
  }
  if (!res.ok) {
    return { ...base, error: data?.error || `updater 检查失败（HTTP ${res.status}）` };
  }
  const behind = Number(data.behind || 0);
  const repoUpToDateButStale = sameCommit(build.commit, data.localCommit) === false;
  return {
    ...base,
    branch: data.branch || null,
    remoteCommit: data.remoteCommit || null,
    repoCommit: data.localCommit || null,
    behind,
    commits: Array.isArray(data.commits) ? data.commits.slice(0, 20) : [],
    // 落后于远端，或仓库已拉取但镜像还没重建，都算"有更新可装"。
    hasUpdate: behind > 0 || repoUpToDateButStale
  };
}

async function checkViaGithub(): Promise<UpdateCheckResult> {
  const build = getBuildInfo();
  const repo = getGithubRepo();
  const branch = getGithubBranch();
  const base: UpdateCheckResult = {
    checkedAt: new Date().toISOString(),
    runningCommit: build.commit,
    builtAt: build.builtAt,
    branch,
    remoteCommit: null,
    repoCommit: null,
    behind: null,
    commits: [],
    hasUpdate: false,
    updaterAvailable: false,
    source: "github",
    error: null
  };
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "shibei-update-check" };
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) {
      return { ...base, error: `GitHub API 请求失败（HTTP ${res.status}），且 updater 未运行。` };
    }
    const head = (await res.json()) as { sha?: string };
    const remoteSha = head?.sha || null;
    base.remoteCommit = remoteSha;
    const same = sameCommit(build.commit, remoteSha);
    if (same === null) {
      return {
        ...base,
        error: "当前运行版本未知（镜像构建时没有注入 GIT_COMMIT），无法与远端比较。"
      };
    }
    if (same) return base;

    // 有差异：再用 compare API 拿落后数量与提交列表（失败不致命）。
    const local = build.commit.replace(/-dirty$/, "");
    try {
      const cmp = await fetch(
        `https://api.github.com/repos/${repo}/compare/${encodeURIComponent(local)}...${encodeURIComponent(branch)}`,
        { headers, cache: "no-store", signal: AbortSignal.timeout(15_000) }
      );
      if (cmp.ok) {
        const diff = (await cmp.json()) as {
          ahead_by?: number;
          commits?: Array<{ sha: string; commit?: { message?: string; author?: { name?: string; date?: string } } }>;
        };
        base.behind = typeof diff.ahead_by === "number" ? diff.ahead_by : null;
        base.commits = (diff.commits || [])
          .slice(-20)
          .reverse()
          .map((c) => ({
            sha: c.sha.slice(0, 8),
            author: c.commit?.author?.name,
            date: c.commit?.author?.date,
            subject: (c.commit?.message || "").split("\n")[0]
          }));
      }
    } catch {
      /* compare 拿不到就只报"有新版本" */
    }
    return { ...base, hasUpdate: true };
  } catch (err) {
    return {
      ...base,
      source: "none",
      error: `无法检查更新：updater 未运行，GitHub API 也不可达（${err instanceof Error ? err.message : String(err)}）。`
    };
  }
}

// 结果缓存 10 分钟：后台每个页面都会触发检查，别把 git fetch / GitHub 限额打爆。
const CHECK_TTL_MS = 10 * 60_000;
let cachedCheck: { at: number; data: UpdateCheckResult } | null = null;
let inFlight: Promise<UpdateCheckResult> | null = null;

export async function checkForUpdate(force = false): Promise<UpdateCheckResult> {
  if (!force && cachedCheck && Date.now() - cachedCheck.at < CHECK_TTL_MS) {
    return cachedCheck.data;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const result = (await checkViaUpdater()) ?? (await checkViaGithub());
      cachedCheck = { at: Date.now(), data: result };
      return result;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export async function triggerUpdate(): Promise<{ ok: boolean; status: number; error?: string }> {
  let res: Response;
  try {
    res = await updaterFetch("/update", { method: "POST" }, 20_000);
  } catch {
    return {
      ok: false,
      status: 503,
      error: "updater 服务不可达。请确认 docker compose 里的 updater 容器已启动（docker compose up -d updater）。"
    };
  }
  if (res.status === 202) {
    cachedCheck = null; // 更新启动后旧的检查结果作废
    return { ok: true, status: 202 };
  }
  let message = `updater 返回 HTTP ${res.status}`;
  try {
    const data = await res.json();
    if (data?.error) message = data.error;
  } catch {
    /* keep default */
  }
  return { ok: false, status: res.status, error: message };
}

export async function getUpdaterStatus(): Promise<UpdaterStatus> {
  try {
    const res = await updaterFetch("/status", { method: "GET" }, 10_000);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return {
        updaterAvailable: false,
        running: false,
        phase: "unavailable",
        startedAt: null,
        finishedAt: null,
        ok: null,
        error: data?.error || `updater 返回 HTTP ${res.status}`,
        log: []
      };
    }
    const data = await res.json();
    return {
      updaterAvailable: true,
      running: Boolean(data.running),
      phase: String(data.phase || "idle"),
      startedAt: data.startedAt || null,
      finishedAt: data.finishedAt || null,
      ok: typeof data.ok === "boolean" ? data.ok : null,
      error: data.error || null,
      log: Array.isArray(data.log) ? data.log.slice(-400) : [],
      repo: data.repo
    };
  } catch {
    return {
      updaterAvailable: false,
      running: false,
      phase: "unavailable",
      startedAt: null,
      finishedAt: null,
      ok: null,
      error: null,
      log: []
    };
  }
}
