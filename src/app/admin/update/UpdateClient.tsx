"use client";

// /admin/update 的交互主体：版本对比、检查更新、一键更新、实时日志。

import { useEffect, useRef, useState } from "react";
import { I18nText } from "@/components/I18nText";
import {
  fetchAdminJson,
  useUpdateRunner,
  type CheckPayload,
  type StatusPayload
} from "@/components/update-flow";

type Props = {
  mode: "frontend" | "backend" | "full";
  composeFile: string;
  runningCommit: string;
  builtAt: string | null;
};

function shortSha(sha: string | null | undefined): string {
  return sha ? sha.replace(/-dirty$/, "").slice(0, 7) : "—";
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN");
}

export function UpdateClient({ mode, composeFile, runningCommit, builtAt }: Props) {
  const [check, setCheck] = useState<CheckPayload | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const runner = useUpdateRunner();
  const logRef = useRef<HTMLPreElement | null>(null);

  const runCheck = async (force: boolean) => {
    setChecking(true);
    setCheckError(null);
    const data = await fetchAdminJson<CheckPayload>(`/api/admin/update/check${force ? "?force=1" : ""}`);
    setChecking(false);
    if (!data) {
      setCheckError("检查请求失败（可能登录已过期，请刷新页面）。/ Check request failed.");
      return;
    }
    setCheck(data);
  };

  // 首次进入：先探 updater 状态——更新已在进行（从弹窗触发后切过来的）就直接
  // 接管进度轮询并跳过检查（此时 /check 会被 updater 以 409 拒绝，白白报错）；
  // 空闲才做常规版本检查。
  useEffect(() => {
    let cancelled = false;
    fetchAdminJson<StatusPayload>("/api/admin/update/status").then((status) => {
      if (cancelled) return;
      if (status?.running) {
        runner.attach();
      } else {
        void runCheck(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 更新成功后复查一次：版本卡片翻新为「已是最新」，作为除日志外的第二重确认。
  useEffect(() => {
    if (runner.phase === "done") void runCheck(true);
  }, [runner.phase]);

  // 日志自动滚到底部
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [runner.status?.log?.length]);

  const busy = runner.phase === "starting" || runner.phase === "working" || runner.phase === "restarting";
  const updaterAvailable = check?.updaterAvailable ?? false;

  const confirmAndStart = () => {
    if (
      !window.confirm(
        "确定现在更新吗？\n\n服务器将拉取最新代码并重建镜像（约 3-10 分钟），期间站点会短暂中断几十秒。\n服务器仓库里未提交的本地改动会被丢弃（git reset --hard）。"
      )
    ) {
      return;
    }
    void runner.start();
  };

  return (
    <>
      {/* 版本状态 */}
      <section className="form-card form-stack" style={{ maxWidth: 720 }}>
        <h2 style={{ marginTop: 0 }}>
          <I18nText zh="版本状态" en="Version Status" />
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "8px 16px" }}>
          <div>
            <I18nText zh="部署形态" en="App mode" />
          </div>
          <div>
            <code>{mode}</code>
          </div>
          <div>
            <I18nText zh="正在运行" en="Running" />
          </div>
          <div>
            <code>{runningCommit}</code>
            {builtAt ? (
              <span className="muted">
                {" "}
                <I18nText zh={`（构建于 ${formatTime(builtAt)}）`} en={` (built ${formatTime(builtAt)})`} />
              </span>
            ) : null}
          </div>
          {check?.repoCommit ? (
            <>
              <div>
                <I18nText zh="服务器仓库" en="Server repo" />
              </div>
              <div>
                <code>{shortSha(check.repoCommit)}</code>
              </div>
            </>
          ) : null}
          <div>
            <I18nText zh="远端最新" en="Remote latest" />
          </div>
          <div>
            {check ? (
              <>
                <code>{shortSha(check.remoteCommit)}</code>
                {check.branch ? <span className="muted">{` · ${check.branch}`}</span> : null}
              </>
            ) : (
              <I18nText zh="检查中…" en="Checking…" />
            )}
          </div>
          <div>
            <I18nText zh="更新服务" en="Updater" />
          </div>
          <div>
            {check == null ? (
              "…"
            ) : updaterAvailable ? (
              <I18nText zh="已连接（可一键更新）" en="Connected (one-click updates ready)" />
            ) : (
              <span style={{ color: "var(--color-warning, #b7791f)" }}>
                <I18nText zh="未运行（只能检查，不能一键更新）" en="Not running (check only)" />
              </span>
            )}
          </div>
          {check?.checkedAt ? (
            <>
              <div>
                <I18nText zh="上次检查" en="Last check" />
              </div>
              <div>{formatTime(check.checkedAt)}</div>
            </>
          ) : null}
        </div>

        {check?.error ? (
          <p style={{ color: "var(--color-danger, #c44)", margin: 0 }}>{check.error}</p>
        ) : null}
        {checkError ? <p style={{ color: "var(--color-danger, #c44)", margin: 0 }}>{checkError}</p> : null}

        {check && !check.error ? (
          check.hasUpdate ? (
            <p style={{ margin: 0, fontWeight: 650 }}>
              {typeof check.behind === "number" && check.behind > 0 ? (
                <I18nText zh={`有新版本：落后 ${check.behind} 个提交。`} en={`Update available: ${check.behind} commit(s) behind.`} />
              ) : (
                <I18nText
                  zh="服务器仓库已是最新，但应用镜像还没重建——点「立即更新」完成重建上线。"
                  en="Repo is current but the running image is stale — run the update to rebuild."
                />
              )}
            </p>
          ) : (
            <p style={{ margin: 0, color: "var(--color-success, #2a8)" }}>
              <I18nText zh="已是最新版本。" en="You are up to date." />
            </p>
          )
        ) : null}

        <div className="meta-row" style={{ gap: 12, flexWrap: "wrap" }}>
          <button type="button" className="button secondary" onClick={() => void runCheck(true)} disabled={checking || busy}>
            {checking ? <I18nText zh="检查中…" en="Checking…" /> : <I18nText zh="检查更新" en="Check for Updates" />}
          </button>
          {/* 已是最新时也允许点击：用于 .env 变更后强制重建等场景，confirm 会拦住误触 */}
          <button
            type="button"
            className="button"
            onClick={confirmAndStart}
            disabled={busy || !updaterAvailable || !check}
            title={!updaterAvailable ? "需要 updater 伴车容器（见下方说明）" : undefined}
          >
            {busy ? <I18nText zh="更新进行中…" en="Updating…" /> : <I18nText zh="立即更新" en="Update Now" />}
          </button>
        </div>
      </section>

      {/* 落后的提交列表 */}
      {check?.hasUpdate && check.commits.length > 0 ? (
        <section className="form-card form-stack" style={{ marginTop: 24, maxWidth: 720 }}>
          <h2 style={{ marginTop: 0 }}>
            <I18nText zh="将要应用的提交" en="Incoming Commits" />
          </h2>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 8 }}>
            {check.commits.map((c) => (
              <li key={c.sha} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <code>{shortSha(c.sha)}</code>
                <span style={{ flex: "1 1 240px" }}>{c.subject}</span>
                <span className="muted" style={{ fontSize: 13 }}>
                  {c.author || ""}
                  {c.date ? ` · ${formatTime(c.date)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* updater 未运行的启用说明 */}
      {check && !updaterAvailable ? (
        <section className="form-card form-stack" style={{ marginTop: 24, maxWidth: 720 }}>
          <h2 style={{ marginTop: 0 }}>
            <I18nText zh="如何启用一键更新" en="Enable One-Click Updates" />
          </h2>
          <p className="muted-block" style={{ margin: 0 }}>
            <I18nText
              zh="一键更新由 compose 里的 updater 伴车容器执行（它挂载 docker.sock 和仓库目录，只在内网监听）。在服务器上执行一次："
              en="One-click updates are executed by the updater sidecar defined in compose. Run once on the server:"
            />
          </p>
          <pre className="update-log" style={{ maxHeight: 120 }}>
            {`cd <仓库目录>\ndocker compose -f ${composeFile} up -d --build updater`}
          </pre>
          <p className="muted-block" style={{ margin: 0 }}>
            <I18nText
              zh="之后即可在本页与左上角弹窗中一键更新。updater 自身很少变动；如果某次更新提示 updater 已修改，再手动执行一次上面的命令即可。"
              en="After that, updates run from this page. If a release notes the updater itself changed, re-run the command once."
            />
          </p>
        </section>
      ) : null}

      {/* 更新进度与日志 */}
      {runner.phase !== "idle" ? (
        <section
          className="form-card form-stack"
          style={{
            marginTop: 24,
            maxWidth: 720,
            borderColor:
              runner.phase === "done"
                ? "var(--color-success, #2a8)"
                : runner.phase === "failed"
                  ? "var(--color-danger, #c44)"
                  : undefined
          }}
        >
          <h2 style={{ marginTop: 0 }}>
            {runner.phase === "done" ? (
              <I18nText zh="更新完成" en="Update Finished" />
            ) : runner.phase === "failed" ? (
              <I18nText zh="更新失败" en="Update Failed" />
            ) : (
              <I18nText zh="更新进行中" en="Update in Progress" />
            )}
          </h2>
          <p style={{ margin: 0 }}>
            {runner.phase === "starting" ? (
              <I18nText zh="正在通知更新服务…" en="Contacting updater…" />
            ) : runner.phase === "working" ? (
              <I18nText
                zh={`阶段：${runner.status?.phase || "…"}（构建镜像可能需要几分钟，可离开本页，更新会继续）`}
                en={`Phase: ${runner.status?.phase || "…"} (builds take minutes; you can leave this page)`}
              />
            ) : runner.phase === "restarting" ? (
              <I18nText zh="应用容器重启中，连接短暂中断属正常现象…" en="App restarting; brief disconnects are expected…" />
            ) : runner.phase === "done" ? (
              <I18nText zh="新版本已上线。刷新页面即可看到新的运行版本号。" en="New version is live. Reload to see it." />
            ) : (
              <span style={{ color: "var(--color-danger, #c44)" }}>{runner.error}</span>
            )}
          </p>
          {runner.phase === "done" ? (
            <div>
              <button type="button" className="button" onClick={() => window.location.reload()}>
                <I18nText zh="刷新页面" en="Reload" />
              </button>
            </div>
          ) : null}
          {runner.status?.log?.length ? (
            <pre ref={logRef} className="update-log">
              {runner.status.log.join("\n")}
            </pre>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
