import { AdminShell } from "@/components/AdminShell";
import { I18nText } from "@/components/I18nText";
import { SubmitButton } from "@/components/SubmitButton";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAppMode } from "@/lib/app-mode";
import { getResolvedSyncConfig } from "@/lib/sync/config";
import { MAX_SYNC_SINGLE_FILE_BYTES, MAX_SYNC_ZIP_BYTES } from "@/lib/sync/limits";

export const dynamic = "force-dynamic";

function formatAgo(from: Date, to: Date): { zh: string; en: string } {
  const seconds = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
  if (seconds < 90) return { zh: `${seconds} 秒前`, en: `${seconds}s ago` };
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return { zh: `${minutes} 分钟前`, en: `${minutes} min ago` };
  const hours = Math.round(minutes / 60);
  if (hours < 48) return { zh: `${hours} 小时前`, en: `${hours}h ago` };
  return { zh: from.toLocaleString("zh-CN"), en: from.toLocaleString("zh-CN") };
}

export default async function SyncAdminPage({
  searchParams,
}: {
  searchParams?: Promise<{ imported?: string; videos?: string; files?: string; errors?: string; pulled?: string; configError?: string; test?: string; latency?: string; detail?: string }>;
}) {
  await requireAdmin();
  const sp = (await searchParams) || {};
  const mode = getAppMode();
  const now = new Date();
  const [cfg, state, settings] = await Promise.all([
    getResolvedSyncConfig(),
    prisma.syncState.findUnique({ where: { id: "sync" } }).catch(() => null),
    prisma.siteSettings.findUnique({ where: { id: "site" } }).catch(() => null),
  ]);
  const [postCount, publishedCount, videoCount] = await Promise.all([
    prisma.post.count().catch(() => 0),
    prisma.post.count({ where: { status: "PUBLISHED" } }).catch(() => 0),
    prisma.video.count().catch(() => 0),
  ]);
  const settingsConfig = settings as {
    syncMode?: string | null;
    syncBackendUrl?: string | null;
    syncTokenEnc?: string | null;
    syncIntervalMinutes?: number | null;
  } | null;

  const sinceForExport = state?.lastExportedAt ? state.lastExportedAt.toISOString() : "";
  const exportFullHref = `/api/admin/sync/export?includeFiles=1`;
  const exportIncrementalHref = sinceForExport
    ? `/api/admin/sync/export?since=${encodeURIComponent(sinceForExport)}&includeFiles=1`
    : null;
  const exportLightHref = `/api/admin/sync/export`;
  // 本端实际生效的导入限额（随 APP_MODE 与 SYNC_MAX_* 环境变量变化），
  // 文案必须跟它走：frontend 默认只有 64MB/48MB，写死 512MB 会误导管理员。
  const zipLimitMb = Math.round(MAX_SYNC_ZIP_BYTES / 1024 / 1024);
  const fileLimitMb = Math.round(MAX_SYNC_SINGLE_FILE_BYTES / 1024 / 1024);
  const videosHiddenLocally =
    (mode === "frontend" || mode === "full")
    && videoCount > 0
    && (settings as { videosEnabled?: boolean } | null)?.videosEnabled !== true;

  // 提示横幅(导入/拉取后的反馈)
  const importedNum = Number(sp.imported || 0);
  const importedVideos = Number(sp.videos || 0);
  const importedFiles = Number(sp.files || 0);
  const importedErrors = Number(sp.errors || 0);

  return (
    <AdminShell>
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">Sync</p>
          <h1><I18nText zh="数据同步" en="Data Sync" /></h1>
        </div>
      </div>
      <p className="muted-block" style={{ maxWidth: 720 }}>
        <I18nText zh="在「前端 / 后端 / 完整版」之间转移文章和视频。后端导出 ZIP；前端拉取 ZIP 或手动上传。" en="Move posts and videos between frontend / backend / full deployments. The backend exports a ZIP; the frontend pulls it or you upload it manually." />
        <I18nText zh="共享密钥与 backend 入口可以在本页保存；环境变量仍可作为兜底。" en="The shared token and backend URL can be saved here; environment variables remain the fallback." />
      </p>

      {videosHiddenLocally ? (
        <div className="form-card" style={{ maxWidth: 720, borderColor: "var(--color-warning, #c80)", background: "rgba(204,136,0,0.06)" }}>
          <strong><I18nText zh="本端已有视频，但「视频功能」尚未开启" en="Videos exist locally, but the video feature is disabled" /></strong>
          <p style={{ margin: "6px 0 0" }}>
            <I18nText
              zh={<>当前本端共有 {videoCount} 个视频记录（含同步而来的），但本实例的视频功能开关是关闭的：前台文章不会展示任何视频，<code>[[video:ID]]</code> 短代码会被静默移除。该开关<strong>不随同步传递</strong>，需要在本端 <a className="text-link" href="/admin/settings?tab=media">设置 → 媒体视频</a> 勾选「启用视频功能」。</>}
              en={<>This instance holds {videoCount} video records (including synced ones), but its video feature is off: public posts render no videos and <code>[[video:ID]]</code> shortcodes are silently stripped. The switch <strong>does not sync</strong> — enable it locally under <a className="text-link" href="/admin/settings?tab=media">Settings → Media</a>.</>}
            />
          </p>
        </div>
      ) : null}
      {sp.imported ? (
        <div
          className="form-card"
          style={{
            maxWidth: 720,
            borderColor: importedErrors ? "var(--color-warning, #c80)" : "var(--color-success, #2a8)",
            background: importedErrors ? "rgba(204,136,0,0.06)" : "rgba(42,170,136,0.06)",
          }}
        >
          <strong>{importedErrors ? <I18nText zh="导入完成（有错误）" en="Import finished (with errors)" /> : <I18nText zh="导入完成" en="Import finished" />}</strong>
          <p style={{ margin: "6px 0 0" }}>
            <I18nText zh={`写入 ${importedNum} 篇文章 · ${importedVideos} 个视频`} en={`Wrote ${importedNum} posts · ${importedVideos} videos`} />
            {importedFiles ? <I18nText zh={` · ${importedFiles} 个本地视频文件`} en={` · ${importedFiles} local video files`} /> : ""}
            {importedErrors ? <I18nText zh={` · ${importedErrors} 条错误（详情见下方「上次错误」）`} en={` · ${importedErrors} errors (see “Last error” below)`} /> : ""}。
          </p>
        </div>
      ) : null}
      {sp.pulled ? (
        <div className="form-card" style={{ maxWidth: 720, borderColor: "var(--color-success, #2a8)" }}>
          <strong><I18nText zh="立即同步成功:" en="Sync succeeded: " />{sp.pulled}</strong>
        </div>
      ) : null}
      {sp.test === "ok" ? (
        <div className="form-card" style={{ maxWidth: 720, borderColor: "var(--color-success, #2a8)", background: "rgba(42,170,136,0.06)" }}>
          <strong><I18nText zh="测试连接成功" en="Connection test passed" /></strong>
          <p style={{ margin: "6px 0 0" }}>
            <I18nText
              zh={`backend 可达且共享密钥有效${sp.latency ? `,往返 ${sp.latency} ms` : ""}。自动同步将在数秒到 1 分钟内跟进。`}
              en={`Backend reachable, shared token valid${sp.latency ? `, round trip ${sp.latency} ms` : ""}. Auto sync follows within seconds to a minute.`}
            />
          </p>
        </div>
      ) : null}
      {sp.test === "legacy" ? (
        <div className="form-card" style={{ maxWidth: 720, borderColor: "var(--color-success, #2a8)", background: "rgba(42,170,136,0.06)" }}>
          <strong><I18nText zh="连接成功（旧版 backend）" en="Connected (older backend)" /></strong>
          <p style={{ margin: "6px 0 0" }}>
            <I18nText
              zh={`backend 可达且共享密钥有效${sp.latency ? `,往返 ${sp.latency} ms` : ""},但对端版本较旧、没有 probe 端点:同步会按固定间隔进行。更新 backend 后可获得分钟级同步。`}
              en={`Backend reachable and the token works${sp.latency ? ` (round trip ${sp.latency} ms)` : ""}, but it predates the probe endpoint, so syncs stay interval-based. Update the backend for minute-level sync.`}
            />
          </p>
        </div>
      ) : null}
      {sp.test === "fail" ? (
        <div className="form-card" style={{ maxWidth: 720, borderColor: "var(--color-danger, #c44)", background: "rgba(204,68,68,0.06)" }}>
          <strong><I18nText zh="测试连接失败" en="Connection test failed" /></strong>
          <p style={{ margin: "6px 0 0", overflowWrap: "anywhere", fontFamily: "var(--font-mono, monospace)", fontSize: 13 }}>
            {sp.detail || ""}
          </p>
          <p style={{ margin: "6px 0 0" }}>
            <I18nText zh="常见原因:backend 入口拼写错误、对端未运行、防火墙未放行、两端共享密钥不一致。" en="Common causes: a mistyped backend URL, the backend being down, a firewall in the way, or mismatched shared tokens." />
          </p>
        </div>
      ) : null}
      {sp.test === "unconfigured" ? (
        <div className="form-card" style={{ maxWidth: 720, borderColor: "var(--color-warning, #c80)" }}>
          <strong><I18nText zh="请先保存 backend 入口与共享密钥,再测试连接。" en="Save the backend URL and shared token before testing." /></strong>
        </div>
      ) : null}
      {sp.configError === "unsafe-backend-url" ? (
        <div className="form-card" style={{ maxWidth: 720, borderColor: "var(--color-danger, #c44)" }}>
          <strong><I18nText zh="Backend 入口未保存" en="Backend URL was not saved" /></strong>
          <p style={{ margin: "6px 0 0" }}>
            <I18nText
              zh="公网地址必须使用 HTTPS；HTTP 只允许 localhost、私网 IP 或 Docker/LAN 单标签服务名，且不能带路径、凭据、查询或片段。"
              en="Public endpoints must use HTTPS. HTTP is limited to localhost, private IPs, or single-label Docker/LAN service names; paths, credentials, queries, and fragments are not allowed."
            />
          </p>
        </div>
      ) : null}

      {/* 状态卡片 */}
      <section className="form-card form-stack" style={{ maxWidth: 720 }}>
        <h2 style={{ marginTop: 0 }}><I18nText zh="当前状态" en="Current Status" /></h2>
        <div className="admin-status-grid">
          <div><I18nText zh="当前模式" en="App mode" /></div>
          <div>
            <code>{mode}</code>
          </div>
          <div><I18nText zh="同步模式" en="Sync mode" /></div>
          <div>
            <code>{cfg.mode}</code>
            {mode === "frontend" && cfg.mode === "auto"
              ? <I18nText zh={`（配置保存后数秒生效;新内容约 1 分钟内到达,每 ${cfg.intervalMinutes} 分钟全量对账）`} en={` (config applies within seconds; new content lands in ~1 min, full reconcile every ${cfg.intervalMinutes} min)`} />
              : ""}
          </div>
          <div><I18nText zh="Backend 入口" en="Backend URL" /></div>
          <div>
            {cfg.backendUrl ? <code>{cfg.backendUrl}</code> : <em><I18nText zh="未配置" en="not set" /></em>}
            {cfg.backendUrlSource !== "none" ? ` (${cfg.backendUrlSource})` : ""}
          </div>
          <div><I18nText zh="共享密钥" en="Shared token" /></div>
          <div>
            {cfg.syncTokenConfigured ? <I18nText zh="已配置" en="configured" /> : <em><I18nText zh="未配置" en="not set" /></em>}
            {cfg.syncTokenSource !== "none" ? ` (${cfg.syncTokenSource})` : ""}
          </div>
          {cfg.syncTokenDecryptError ? (
            <>
              <div style={{ color: "var(--color-danger, #c44)" }}><I18nText zh="密钥读取" en="Token decryption" /></div>
              <div style={{ color: "var(--color-danger, #c44)" }}>
                <I18nText zh="数据库中的密钥无法解密，请重新保存共享密钥。" en="The stored token cannot be decrypted — save the shared token again." />
              </div>
            </>
          ) : null}
          {mode === "frontend" ? (
            <>
              <div><I18nText zh="同步进程" en="Sync worker" /></div>
              <div>
                {(() => {
                  const alive = state?.workerAliveAt && now.getTime() - state.workerAliveAt.getTime() < 45_000;
                  if (alive) {
                    const ago = formatAgo(state!.workerAliveAt!, now);
                    return (
                      <span style={{ color: "var(--color-success, #2a8)" }}>
                        <I18nText zh={`运行中（心跳 ${ago.zh}）`} en={`running (heartbeat ${ago.en})`} />
                      </span>
                    );
                  }
                  if (state?.workerAliveAt) {
                    const ago = formatAgo(state.workerAliveAt, now);
                    return (
                      <span style={{ color: "var(--color-danger, #c44)" }}>
                        <I18nText zh={`未检测到心跳（上次 ${ago.zh}）,请重启前端容器`} en={`no heartbeat (last ${ago.en}) — restart the frontend container`} />
                      </span>
                    );
                  }
                  return (
                    <span style={{ color: "var(--color-danger, #c44)" }}>
                      <I18nText zh="从未上报心跳(旧版本镜像或进程未启动)" en="never reported (old image or process not started)" />
                    </span>
                  );
                })()}
              </div>
            </>
          ) : null}
          {(mode === "frontend" || mode === "full") && cfg.backendUrl ? (
            <>
              <div><I18nText zh="Backend 连通" en="Backend link" /></div>
              <div>
                {(() => {
                  const judged = mode === "frontend" && cfg.mode === "auto";
                  if (!state?.backendReachableAt) {
                    return (
                      <span style={{ color: judged ? "var(--color-danger, #c44)" : undefined }}>
                        <I18nText zh="从未连通成功" en="never reached" />
                      </span>
                    );
                  }
                  const ago = formatAgo(state.backendReachableAt, now);
                  // 自动模式下 probe 每分钟一轮,失败退避最长 5 分钟:
                  // 超过 ~6 分钟没有成功记录即视为断开。
                  const fresh = now.getTime() - state.backendReachableAt.getTime() < 6.5 * 60 * 1000;
                  if (!judged) {
                    return <I18nText zh={`最近连通成功:${ago.zh}`} en={`last reached ${ago.en}`} />;
                  }
                  return fresh ? (
                    <span style={{ color: "var(--color-success, #2a8)" }}>
                      <I18nText zh={`已连通（${ago.zh}确认）`} en={`connected (verified ${ago.en})`} />
                    </span>
                  ) : (
                    <span style={{ color: "var(--color-danger, #c44)" }}>
                      <I18nText zh={`已断开（上次成功 ${ago.zh}）`} en={`disconnected (last success ${ago.en})`} />
                    </span>
                  );
                })()}
              </div>
            </>
          ) : null}
          {(mode === "frontend" || mode === "full") && state?.lastAttemptAt ? (
            <>
              <div><I18nText zh="上次拉取尝试" en="Last pull attempt" /></div>
              <div>{formatAgo(state.lastAttemptAt, now).zh}</div>
            </>
          ) : null}
          <div><I18nText zh="本端文章总数" en="Local posts" /></div>
          <div>
            {postCount} · PUBLISHED {publishedCount}
          </div>
          <div><I18nText zh="本端视频总数" en="Local videos" /></div>
          <div>{videoCount}</div>
          <div><I18nText zh="上次成功导入" en="Last import" /></div>
          <div>
            {state?.lastImportedAt ? state.lastImportedAt.toLocaleString("zh-CN") : "—"}
            {state?.lastImportedPostCount ? ` (${state.lastImportedPostCount} 篇)` : ""}
          </div>
          <div><I18nText zh="上次导出" en="Last export" /></div>
          <div>{state?.lastExportedAt ? state.lastExportedAt.toLocaleString("zh-CN") : "—"}</div>
          {state?.lastError ? (
            <>
              <div style={{ color: "var(--color-danger, #c44)" }}><I18nText zh="上次错误" en="Last error" /></div>
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  maxHeight: 180,
                  overflowY: "auto",
                  color: "var(--color-danger, #c44)",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 13,
                }}
              >
                {state.lastError}
              </div>
            </>
          ) : null}
        </div>
      </section>

      <section className="form-card form-stack" style={{ marginTop: 24, maxWidth: 720 }}>
        <h2 style={{ marginTop: 0 }}><I18nText zh="网页端同步配置" en="Sync Configuration" /></h2>
        <p className="muted-block">
          {mode === "backend"
            ? <I18nText zh="后端服务器只需要保存共享密钥，供前端自动拉取或手动同步时鉴权。" en="A backend server only needs the shared token, used to authenticate frontend pulls." />
            : <I18nText zh="前端服务器只需要填写 backend 入口和共享密钥。自动模式会按间隔拉取；手动模式只保留 ZIP 上传/立即同步按钮。" en="A frontend server only needs the backend URL and shared token. Auto mode pulls on an interval; manual mode keeps only ZIP upload / sync-now." />}
        </p>
        <form action="/api/admin/sync/config" method="post" className="form-stack">
          <div className="field-row">
            <div className="field">
              <label htmlFor="syncMode"><I18nText zh="同步模式" en="Sync mode" /></label>
              <select id="syncMode" name="syncMode" defaultValue={cfg.mode}>
                <option value="auto">自动更新（默认）/ Auto</option>
                <option value="manual">手动上传/手动同步 / Manual</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="syncIntervalMinutes"><I18nText zh="自动拉取间隔（分钟）" en="Pull interval (minutes)" /></label>
              <input
                id="syncIntervalMinutes"
                name="syncIntervalMinutes"
                type="number"
                min={1}
                max={1440}
                defaultValue={cfg.intervalMinutes}
              />
            </div>
          </div>
          {mode !== "backend" ? (
            <div className="field">
              <label htmlFor="syncBackendUrl"><I18nText zh="Backend 入口" en="Backend URL" /></label>
              <input
                id="syncBackendUrl"
                name="syncBackendUrl"
                type="url"
                placeholder="https://api.example.com"
                defaultValue={settingsConfig?.syncBackendUrl || cfg.backendUrl}
              />
              <small className="muted">
                <I18nText zh="公网必须使用 HTTPS；受保护私网可填私网 IP，Docker 网络可填单标签服务名。留空时使用环境变量 BACKEND_API_URL。" en="HTTPS is required over the public internet. A protected LAN may use a private IP, and Docker networks may use a single-label service name. Empty values fall back to BACKEND_API_URL." />
              </small>
            </div>
          ) : (
            <input type="hidden" name="syncBackendUrl" value={cfg.backendUrl} />
          )}
          <div className="field">
            <label htmlFor="syncToken"><I18nText zh="共享密钥" en="Shared token" /></label>
            <input
              id="syncToken"
              name="syncToken"
              type="password"
              placeholder={cfg.syncTokenConfigured ? "已配置，留空不修改" : "填入与另一端相同的一串随机密钥"}
              autoComplete="new-password"
            />
            <small className="muted"><I18nText zh="密钥会加密存入数据库；前端与后端必须使用同一串。" en="Stored encrypted; frontend and backend must use the same token." /></small>
          </div>
          {settingsConfig?.syncTokenEnc ? (
            <label>
              <input type="checkbox" name="clearSyncToken" value="true" /> <I18nText zh="清除数据库中的共享密钥（改用环境变量或重新填写）" en="Clear the stored token (use env vars or re-enter)" />
            </label>
          ) : null}
          <SubmitButton pendingLabel={<I18nText zh="保存中…" en="Saving…" />}><I18nText zh="保存同步配置" en="Save Sync Config" /></SubmitButton>
        </form>
      </section>

      {/* 拉取(frontend / full) */}
      {(mode === "frontend" || mode === "full") && (
        <section className="form-card form-stack" style={{ marginTop: 24, maxWidth: 720 }}>
          <h2 style={{ marginTop: 0 }}><I18nText zh="从 backend 拉取" en="Pull from Backend" /></h2>
          {cfg.backendUrl && cfg.syncToken ? (
            <>
              <p>
                <I18nText zh="立即从 " en="Pull increments now from " /><code>{cfg.backendUrl}</code><I18nText zh=" 拉取增量（更新于上次导入之后的文章 + 视频）。「测试连接」只验证可达性与密钥，不拉数据。" en=" (posts + videos updated since the last import). “Test connection” only verifies reachability and the token, without pulling data." />
              </p>
              <div className="meta-row" style={{ gap: 12, flexWrap: "wrap" }}>
                <form action="/api/admin/sync/pull" method="post">
                  <SubmitButton pendingLabel={<I18nText zh="正在拉取，可能需要几十秒…" en="Pulling, may take a while…" />}><I18nText zh="立即同步" en="Sync Now" /></SubmitButton>
                </form>
                <form action="/api/admin/sync/test" method="post">
                  <SubmitButton pendingLabel={<I18nText zh="正在测试…" en="Testing…" />}><I18nText zh="测试连接" en="Test Connection" /></SubmitButton>
                </form>
              </div>
            </>
          ) : (
            <p className="muted-block">
              <I18nText zh="需要先在上方填写 backend 入口和共享密钥，或在 .env 中设置" en="Fill in the backend URL and shared token above first, or set them in .env:" />{" "}
              <code>BACKEND_API_URL</code> / <code>SYNC_TOKEN</code>。
            </p>
          )}
        </section>
      )}

      {/* 导出(backend / full) */}
      {(mode === "backend" || mode === "full") && (
        <section className="form-card form-stack" style={{ marginTop: 24, maxWidth: 720 }}>
          <h2 style={{ marginTop: 0 }}><I18nText zh="导出 ZIP（backend → 前端手动上传）" en="Export ZIP (backend → manual upload)" /></h2>
          <p>
            <I18nText zh="为前端管理员生成一个 ZIP 文件，包含所有 PUBLISHED 文章和它们的视频（本地视频也会打包）。" en="Generates a ZIP with all PUBLISHED posts and their videos (local files included)." />
            <I18nText zh="前端在「上传 ZIP 导入」一节中传入这个文件即可。当前共有 " en="Feed that file to the “Upload ZIP” section on the frontend. Currently " /><strong>{publishedCount}</strong>{" "}
            <I18nText zh="篇文章可以导出。" en="posts can be exported." />
          </p>
          <div className="meta-row" style={{ gap: 12, flexWrap: "wrap" }}>
            <a className="button" href={exportFullHref} download>
              <I18nText zh="下载全量 ZIP（含本地视频）" en="Full ZIP (with local videos)" />
            </a>
            {exportIncrementalHref ? (
              <a className="button secondary" href={exportIncrementalHref} download>
                <I18nText zh={`下载增量 ZIP（自 ${state?.lastExportedAt?.toLocaleString("zh-CN")}）`} en={`Incremental ZIP (since ${state?.lastExportedAt?.toLocaleString("zh-CN")})`} />
              </a>
            ) : null}
            <a className="text-link" href={exportLightHref} download>
              <I18nText zh="下载轻量 ZIP（不含本地视频文件）" en="Light ZIP (no local video files)" />
            </a>
          </div>
          <p className="muted-block" style={{ marginBottom: 0 }}>
            <I18nText
              zh="注意：接收端（前端形态）默认只接受 64MB 的 ZIP、48MB 的单个视频文件；含视频的 ZIP 超过该值时，需要先在前端调大 SYNC_MAX_ZIP_MB / SYNC_MAX_FILE_MB 再导入。"
              en="Note: a frontend deployment accepts only 64MB ZIPs / 48MB per video file by default; raise SYNC_MAX_ZIP_MB / SYNC_MAX_FILE_MB there before importing larger archives."
            />
          </p>
          {publishedCount === 0 ? (
            <p className="muted-block">
              <I18nText zh="当前没有 PUBLISHED 状态的文章，导出 ZIP 只会包含空的 manifest。" en="No PUBLISHED posts right now — the ZIP would contain an empty manifest." />
            </p>
          ) : null}
        </section>
      )}

      {/* 导入(frontend / full) */}
      {(mode === "frontend" || mode === "full") && (
        <section className="form-card form-stack" style={{ marginTop: 24, maxWidth: 720 }}>
          <h2 style={{ marginTop: 0 }}><I18nText zh="上传 ZIP 导入" en="Upload ZIP to Import" /></h2>
          <p>
            <I18nText zh="把 backend 导出的 ZIP 上传到这里。冲突策略:incoming.updatedAt 较新才覆盖本端的同一篇文章。" en="Upload the backend-exported ZIP. Conflict policy: an incoming post only overwrites when its updatedAt is newer." />
            <I18nText
              zh={`本端 ZIP 体积上限 ${zipLimitMb}MB、单个视频文件上限 ${fileLimitMb}MB（超限文件跳过不中断）；可用环境变量 SYNC_MAX_ZIP_MB / SYNC_MAX_FILE_MB 调整，注意 ZIP 会整体读入内存，上限必须显著小于容器内存。超出时请改用「轻量 ZIP」+ 外链/嵌入视频。`}
              en={`This instance accepts ZIPs up to ${zipLimitMb}MB with files up to ${fileLimitMb}MB each (oversized files are skipped, not fatal). Tune via SYNC_MAX_ZIP_MB / SYNC_MAX_FILE_MB — the ZIP is buffered fully in memory, so keep limits well below container memory. Beyond that, use the light ZIP plus linked/embedded videos.`}
            />
          </p>
          <form
            action="/api/admin/sync/import"
            method="post"
            encType="multipart/form-data"
            className="form-stack"
          >
            <div className="field">
              <label htmlFor="sync-file"><I18nText zh="ZIP 文件" en="ZIP file" /></label>
              <input id="sync-file" type="file" name="file" accept=".zip,application/zip" required />
            </div>
            <input type="hidden" name="redirect" value="/admin/sync" />
            <SubmitButton pendingLabel={<I18nText zh="导入中，大文件可能需要几分钟…" en="Importing, large files take minutes…" />}><I18nText zh="上传并导入" en="Upload & Import" /></SubmitButton>
          </form>
        </section>
      )}
    </AdminShell>
  );
}
