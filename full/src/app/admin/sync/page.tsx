import { AdminShell } from "@/components/AdminShell";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAppMode } from "@/lib/app-mode";
import { getResolvedSyncConfig } from "@/lib/sync/config";

export const dynamic = "force-dynamic";

export default async function SyncAdminPage({
  searchParams,
}: {
  searchParams?: Promise<{ imported?: string; videos?: string; files?: string; errors?: string; pulled?: string }>;
}) {
  await requireAdmin();
  const sp = (await searchParams) || {};
  const mode = getAppMode();
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

  // 提示横幅(导入/拉取后的反馈)
  const importedNum = Number(sp.imported || 0);
  const importedVideos = Number(sp.videos || 0);
  const importedFiles = Number(sp.files || 0);
  const importedErrors = Number(sp.errors || 0);

  return (
    <AdminShell>
      <p className="eyebrow">Sync</p>
      <h1>数据同步</h1>
      <p className="muted-block" style={{ maxWidth: 720 }}>
        在「前端 / 后端 / 完整版」之间转移文章和视频。后端导出 ZIP；前端拉取 ZIP 或手动上传。
        共享密钥与 backend 入口可以在本页保存；环境变量仍可作为兜底。
      </p>

      {sp.imported ? (
        <div
          className="form-card"
          style={{
            maxWidth: 720,
            borderColor: importedErrors ? "var(--color-warning, #c80)" : "var(--color-success, #2a8)",
            background: importedErrors ? "rgba(204,136,0,0.06)" : "rgba(42,170,136,0.06)",
          }}
        >
          <strong>{importedErrors ? "导入完成（有错误）" : "导入完成"}</strong>
          <p style={{ margin: "6px 0 0" }}>
            写入 {importedNum} 篇文章 · {importedVideos} 个视频
            {importedFiles ? ` · ${importedFiles} 个本地视频文件` : ""}
            {importedErrors ? ` · ${importedErrors} 条错误（详情见下方「上次错误」）` : ""}。
          </p>
        </div>
      ) : null}
      {sp.pulled ? (
        <div className="form-card" style={{ maxWidth: 720, borderColor: "var(--color-success, #2a8)" }}>
          <strong>立即同步成功:{sp.pulled}</strong>
        </div>
      ) : null}

      {/* 状态卡片 */}
      <section className="form-card form-stack" style={{ maxWidth: 720 }}>
        <h2 style={{ marginTop: 0 }}>当前状态</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "8px 16px" }}>
          <div>当前模式</div>
          <div>
            <code>{mode}</code>
          </div>
          <div>同步模式</div>
          <div>
            <code>{cfg.mode}</code>
            {mode === "frontend" && cfg.mode === "auto"
              ? `（每 ${cfg.intervalMinutes} 分钟自动拉取）`
              : ""}
          </div>
          <div>Backend 入口</div>
          <div>
            {cfg.backendUrl ? <code>{cfg.backendUrl}</code> : <em>未配置</em>}
            {cfg.backendUrlSource !== "none" ? ` (${cfg.backendUrlSource})` : ""}
          </div>
          <div>共享密钥</div>
          <div>
            {cfg.syncTokenConfigured ? "已配置" : <em>未配置</em>}
            {cfg.syncTokenSource !== "none" ? ` (${cfg.syncTokenSource})` : ""}
          </div>
          {cfg.syncTokenDecryptError ? (
            <>
              <div style={{ color: "var(--color-danger, #c44)" }}>密钥读取</div>
              <div style={{ color: "var(--color-danger, #c44)" }}>
                数据库中的密钥无法解密，请重新保存共享密钥。
              </div>
            </>
          ) : null}
          <div>本端文章总数</div>
          <div>
            {postCount} 篇 · 其中 PUBLISHED {publishedCount} 篇
          </div>
          <div>本端视频总数</div>
          <div>{videoCount}</div>
          <div>上次成功导入</div>
          <div>
            {state?.lastImportedAt ? state.lastImportedAt.toLocaleString("zh-CN") : "—"}
            {state?.lastImportedPostCount ? ` (${state.lastImportedPostCount} 篇)` : ""}
          </div>
          <div>上次导出</div>
          <div>{state?.lastExportedAt ? state.lastExportedAt.toLocaleString("zh-CN") : "—"}</div>
          {state?.lastError ? (
            <>
              <div style={{ color: "var(--color-danger, #c44)" }}>上次错误</div>
              <div
                style={{
                  whiteSpace: "pre-wrap",
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
        <h2 style={{ marginTop: 0 }}>网页端同步配置</h2>
        <p className="muted-block">
          {mode === "backend"
            ? "后端服务器只需要保存共享密钥，供前端自动拉取或手动同步时鉴权。"
            : "前端服务器只需要填写 backend 入口和共享密钥。自动模式会按间隔拉取；手动模式只保留 ZIP 上传/立即同步按钮。"}
        </p>
        <form action="/api/admin/sync/config" method="post" className="form-stack">
          <div className="field-row">
            <div className="field">
              <label htmlFor="syncMode">同步模式</label>
              <select id="syncMode" name="syncMode" defaultValue={cfg.mode}>
                <option value="auto">自动更新（默认）</option>
                <option value="manual">手动上传/手动同步</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="syncIntervalMinutes">自动拉取间隔（分钟）</label>
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
              <label htmlFor="syncBackendUrl">Backend 入口</label>
              <input
                id="syncBackendUrl"
                name="syncBackendUrl"
                type="url"
                placeholder="http://backend.example.com:3000"
                defaultValue={settingsConfig?.syncBackendUrl || cfg.backendUrl}
              />
              <small className="muted">
                如果两台服务器在同一内网，优先填内网地址；留空时使用环境变量 BACKEND_API_URL。
              </small>
            </div>
          ) : (
            <input type="hidden" name="syncBackendUrl" value={settingsConfig?.syncBackendUrl || ""} />
          )}
          <div className="field">
            <label htmlFor="syncToken">共享密钥</label>
            <input
              id="syncToken"
              name="syncToken"
              type="password"
              placeholder={cfg.syncTokenConfigured ? "已配置，留空不修改" : "填入与另一端相同的一串随机密钥"}
              autoComplete="new-password"
            />
            <small className="muted">密钥会加密存入数据库；前端与后端必须使用同一串。</small>
          </div>
          {settingsConfig?.syncTokenEnc ? (
            <label>
              <input type="checkbox" name="clearSyncToken" value="true" /> 清除数据库中的共享密钥（改用环境变量或重新填写）
            </label>
          ) : null}
          <button className="button" type="submit">
            保存同步配置
          </button>
        </form>
      </section>

      {/* 拉取(frontend / full) */}
      {(mode === "frontend" || mode === "full") && (
        <section className="form-card form-stack" style={{ marginTop: 24, maxWidth: 720 }}>
          <h2 style={{ marginTop: 0 }}>从 backend 拉取</h2>
          {cfg.backendUrl && cfg.syncToken ? (
            <>
              <p>
                立即从 <code>{cfg.backendUrl}</code> 拉取增量（更新于上次导入之后的文章 + 视频）。
              </p>
              <form action="/api/admin/sync/pull" method="post">
                <button className="button" type="submit">
                  立即同步
                </button>
              </form>
            </>
          ) : (
            <p className="muted-block">
              需要先在上方填写 backend 入口和共享密钥，或在 .env 中设置{" "}
              <code>BACKEND_API_URL</code> / <code>SYNC_TOKEN</code>。
            </p>
          )}
        </section>
      )}

      {/* 导出(backend / full) */}
      {(mode === "backend" || mode === "full") && (
        <section className="form-card form-stack" style={{ marginTop: 24, maxWidth: 720 }}>
          <h2 style={{ marginTop: 0 }}>导出 ZIP（backend → 前端手动上传）</h2>
          <p>
            为前端管理员生成一个 ZIP 文件，包含所有 PUBLISHED 文章和它们的视频（本地视频也会打包）。
            前端在「上传 ZIP 导入」一节中传入这个文件即可。当前共有 <strong>{publishedCount}</strong>{" "}
            篇文章可以导出。
          </p>
          <div className="meta-row" style={{ gap: 12, flexWrap: "wrap" }}>
            <a className="button" href={exportFullHref} download>
              下载全量 ZIP（含本地视频）
            </a>
            {exportIncrementalHref ? (
              <a className="button-secondary" href={exportIncrementalHref} download>
                下载增量 ZIP（自 {state?.lastExportedAt?.toLocaleString("zh-CN")}）
              </a>
            ) : null}
            <a className="text-link" href={exportLightHref} download>
              下载轻量 ZIP（不含本地视频文件）
            </a>
          </div>
          {publishedCount === 0 ? (
            <p className="muted-block">
              当前没有 PUBLISHED 状态的文章，导出 ZIP 只会包含空的 manifest。
            </p>
          ) : null}
        </section>
      )}

      {/* 导入(frontend / full) */}
      {(mode === "frontend" || mode === "full") && (
        <section className="form-card form-stack" style={{ marginTop: 24, maxWidth: 720 }}>
          <h2 style={{ marginTop: 0 }}>上传 ZIP 导入</h2>
          <p>
            把 backend 导出的 ZIP 上传到这里。冲突策略:incoming.updatedAt 较新才覆盖本端的同一篇文章。
            ZIP 体积上限 512MB；超出请改用「轻量 ZIP」+ 外链/嵌入视频。
          </p>
          <form
            action="/api/admin/sync/import"
            method="post"
            encType="multipart/form-data"
            className="form-stack"
          >
            <div className="field">
              <label htmlFor="sync-file">ZIP 文件</label>
              <input id="sync-file" type="file" name="file" accept=".zip,application/zip" required />
            </div>
            <input type="hidden" name="redirect" value="/admin/sync" />
            <button className="button" type="submit">
              上传并导入
            </button>
          </form>
        </section>
      )}
    </AdminShell>
  );
}
