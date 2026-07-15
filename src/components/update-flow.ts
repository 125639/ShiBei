"use client";

// 网页端一键更新 —— 客户端共享逻辑。
// UpdateNotifier（左上角弹窗）与 /admin/update 页面共用：
//   - fetchAdminJson：处理登录过期被 302 到登录页的情况（拿到 HTML 视为 null）
//   - useUpdateRunner：触发更新 + 轮询进度；应用容器重启窗口的 fetch 失败
//     视为「重启中」继续轮询，直到 updater 报告成功/失败或 20 分钟超时。

import { useCallback, useEffect, useRef, useState } from "react";
import type { UpdateCheckResult, UpdaterStatus } from "@/lib/update";

export type StatusPayload = UpdaterStatus & { runningCommit: string; builtAt: string | null };
export type CheckPayload = UpdateCheckResult;

// 叉掉弹窗后记住的远端版本；出现更新的版本后会重新弹。
export const UPDATE_DISMISS_KEY = "shibei.update.dismissed";

export async function fetchAdminJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { ...init, cache: "no-store" });
    // requireAdmin 未登录时 302 → 登录页 HTML；跟随后 res.ok 为真但不是 JSON。
    if (res.redirected) return null;
    const type = res.headers.get("content-type") || "";
    if (!type.includes("application/json")) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function requestUpdateApply(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/admin/update/apply", { method: "POST", cache: "no-store" });
    if (res.redirected) return { ok: false, error: "登录已过期，请刷新页面重新登录。/ Session expired." };
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 202) return { ok: true };
    return { ok: false, error: data?.error || `请求失败（HTTP ${res.status}）` };
  } catch {
    return { ok: false, error: "网络错误，请稍后重试。/ Network error." };
  }
}

// ---- 客户端检查缓存（弹窗 + 侧栏角标共用，单飞去重）----
// 后台每个页面都渲染 AdminShell → 这些组件反复 mount；15 分钟内共用同一次
// 请求结果（服务端另有 10 分钟缓存兜底），一次导航只发一个请求。
const CLIENT_CHECK_TTL_MS = 15 * 60_000;
let clientCheckCache: { at: number; data: CheckPayload } | null = null;
let clientCheckInFlight: Promise<CheckPayload | null> | null = null;

export function getClientCheck(): Promise<CheckPayload | null> {
  if (clientCheckCache && Date.now() - clientCheckCache.at < CLIENT_CHECK_TTL_MS) {
    return Promise.resolve(clientCheckCache.data);
  }
  if (clientCheckInFlight) return clientCheckInFlight;
  clientCheckInFlight = fetchAdminJson<CheckPayload>("/api/admin/update/check")
    .then((data) => {
      if (data) clientCheckCache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      clientCheckInFlight = null;
    });
  return clientCheckInFlight;
}

// 更新成功后调用：让所有页面的弹窗/角标不再用旧的「有新版本」结果。
export function invalidateClientCheck() {
  clientCheckCache = null;
}

export type UpdateRunPhase = "idle" | "starting" | "working" | "restarting" | "done" | "failed";

const POLL_INTERVAL_MS = 3000;
const RUN_DEADLINE_MS = 20 * 60_000;

export function useUpdateRunner() {
  const [phase, setPhase] = useState<UpdateRunPhase>("idle");
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const poll = useCallback((initialFailCount: number, deadline: number) => {
    function schedulePoll(failCount: number) {
      timerRef.current = setTimeout(async () => {
        if (!aliveRef.current) return;
        if (Date.now() > deadline) {
          setPhase("failed");
          setError("等待更新结果超时（20 分钟）。请到「系统更新」页查看日志，或登录服务器排查。");
          return;
        }
        const data = await fetchAdminJson<StatusPayload>("/api/admin/update/status");
        if (!aliveRef.current) return;
        if (!data) {
          // 应用容器正在被替换（构建后 up -d 阶段），短暂不可达是预期内的。
          setPhase(failCount >= 1 ? "restarting" : "working");
          schedulePoll(failCount + 1);
          return;
        }
        setStatus(data);
        if (data.running) {
          setPhase("working");
          schedulePoll(0);
          return;
        }
        if (data.ok === true) {
          invalidateClientCheck(); // 新版本已上线，旧的「有新版本」检查结果作废
          setPhase("done");
          return;
        }
        if (data.ok === false) {
          setPhase("failed");
          setError(data.error || "更新失败，详见日志。");
          return;
        }
        // updater 空闲且没有任务记录（可能刚被重启）：再等等。
        setPhase("working");
        schedulePoll(failCount + 1);
      }, POLL_INTERVAL_MS);
    }

    schedulePoll(initialFailCount);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setStatus(null);
    setPhase("starting");
    const r = await requestUpdateApply();
    if (!aliveRef.current) return;
    if (!r.ok) {
      setPhase("failed");
      setError(r.error || "无法触发更新。");
      return;
    }
    setPhase("working");
    poll(0, Date.now() + RUN_DEADLINE_MS);
  }, [poll]);

  // 进入页面时发现 updater 已在跑（比如从弹窗触发后切了页面）→ 接管轮询。
  const attach = useCallback(() => {
    setError(null);
    setPhase("working");
    poll(0, Date.now() + RUN_DEADLINE_MS);
  }, [poll]);

  return { phase, status, error, start, attach };
}
