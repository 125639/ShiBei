"use client";

// 左上角新版本弹窗：GitHub 上有新提交时提示管理员「是否更新」。
// - 叉掉后把远端版本记进 localStorage，同一版本不再打扰；更新的版本会再次弹出。
// - 「立即更新」二次确认后触发 updater，弹窗原地变成进度视图（应用重启期间容错）。
// - 挂载时探测一次 updater：如果更新已在进行（本页触发后切走再回来、或另一个
//   标签页触发的），自动接管进度显示，而不是再给一个会撞 409 的「立即更新」按钮。
// - updater 未运行时仍然提示新版本，但按钮引导到 /admin/update 查看启用说明。
// - /admin/update 页面自身有完整界面，在该页不弹。

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { I18nText } from "./I18nText";
import {
  UPDATE_DISMISS_KEY,
  fetchAdminJson,
  getClientCheck,
  useUpdateRunner,
  type CheckPayload,
  type StatusPayload
} from "./update-flow";

function readDismissed(): string {
  try {
    return localStorage.getItem(UPDATE_DISMISS_KEY) || "";
  } catch {
    return "";
  }
}

export function UpdateNotifier() {
  const pathname = usePathname();
  const [check, setCheck] = useState<CheckPayload | null>(null);
  const [dismissed, setDismissed] = useState(true); // SSR/首帧先不渲染，effect 里再判断
  const runner = useUpdateRunner();
  const { attach } = runner;

  useEffect(() => {
    let cancelled = false;
    getClientCheck().then((data) => {
      if (cancelled || !data) return;
      setCheck(data);
      setDismissed(Boolean(data.remoteCommit) && readDismissed() === data.remoteCommit);
      // 只在「有新版本」时才探测是否已有更新在进行（更新必然从弹窗/更新页触发，
      // 触发前检查缓存一定是 hasUpdate=true；这样平时页面导航不多发请求）。
      if (data.hasUpdate) {
        fetchAdminJson<StatusPayload>("/api/admin/update/status").then((status) => {
          if (!cancelled && status?.running) attach();
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [attach]);

  // 更新页有完整界面，不再叠一个弹窗。
  if (pathname?.startsWith("/admin/update")) return null;

  const close = () => {
    try {
      if (check?.remoteCommit) localStorage.setItem(UPDATE_DISMISS_KEY, check.remoteCommit);
    } catch {
      /* localStorage 被禁用时仅本次会话隐藏 */
    }
    setDismissed(true);
  };

  // 进度视图放在所有检查结果守卫之前：更新一旦开始，无论 check 是什么都要显示进度。
  if (runner.phase !== "idle") {
    return (
      <div className="update-toast" role="status" aria-live="polite">
        <div className="update-toast-head">
          <strong>
            {runner.phase === "done" ? (
              <I18nText zh="更新完成" en="Update finished" />
            ) : runner.phase === "failed" ? (
              <I18nText zh="更新失败" en="Update failed" />
            ) : (
              <I18nText zh="正在更新…" en="Updating…" />
            )}
          </strong>
          {runner.phase === "done" || runner.phase === "failed" ? (
            <button type="button" className="update-toast-close" onClick={close} aria-label="关闭 / Close">
              ×
            </button>
          ) : null}
        </div>
        <p className="update-toast-meta">
          {runner.phase === "starting" ? (
            <I18nText zh="正在通知更新服务…" en="Contacting updater…" />
          ) : runner.phase === "working" ? (
            <I18nText
              zh={`拉取代码并重建镜像中（${runner.status?.phase || "…"}），请勿关闭服务器。`}
              en={`Pulling & rebuilding (${runner.status?.phase || "…"}). Keep the server on.`}
            />
          ) : runner.phase === "restarting" ? (
            <I18nText zh="应用容器重启中，连接会短暂中断…" en="App container restarting, brief downtime…" />
          ) : runner.phase === "done" ? (
            <I18nText zh="新版本已上线，刷新页面即可查看。" en="New version is live — refresh to see it." />
          ) : (
            runner.error || "更新失败"
          )}
        </p>
        <div className="update-toast-actions">
          {runner.phase === "done" ? (
            <button type="button" className="button" onClick={() => window.location.reload()}>
              <I18nText zh="刷新页面" en="Reload" />
            </button>
          ) : null}
          <Link className="button secondary" href="/admin/update">
            <I18nText zh="查看日志" en="View log" />
          </Link>
        </div>
      </div>
    );
  }

  if (!check || !check.hasUpdate || !check.remoteCommit) return null;
  if (dismissed) return null;

  const remoteShort = check.remoteCommit.slice(0, 7);
  const runningShort = check.runningCommit.replace(/-dirty$/, "").slice(0, 7);
  const latest = check.commits[0];

  const confirmAndStart = () => {
    if (
      !window.confirm(
        "确定现在更新吗？\n\n服务器将拉取最新代码并重建镜像（约 3-10 分钟），期间站点会短暂中断几十秒。"
      )
    ) {
      return;
    }
    void runner.start();
  };

  return (
    <div className="update-toast" role="dialog" aria-label="发现新版本 / New version available">
      <div className="update-toast-head">
        <strong>
          <I18nText zh="发现新版本" en="New version available" />
        </strong>
        <button type="button" className="update-toast-close" onClick={close} aria-label="关闭 / Close">
          ×
        </button>
      </div>
      <p className="update-toast-meta">
        <code>{runningShort}</code> → <code>{remoteShort}</code>
        {typeof check.behind === "number" && check.behind > 0 ? (
          <I18nText zh={`，落后 ${check.behind} 个提交`} en={`, ${check.behind} commit(s) behind`} />
        ) : null}
      </p>
      {latest ? <p className="update-toast-subject">{latest.subject}</p> : null}
      <div className="update-toast-actions">
        {check.updaterAvailable ? (
          <button type="button" className="button" onClick={confirmAndStart}>
            <I18nText zh="立即更新" en="Update now" />
          </button>
        ) : null}
        <Link className="button secondary" href="/admin/update">
          <I18nText zh={check.updaterAvailable ? "查看详情" : "查看更新方法"} en="Details" />
        </Link>
      </div>
    </div>
  );
}
