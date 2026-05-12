import { AdminShell } from "@/components/AdminShell";
import { BulkSourceActions, type ListSource } from "@/components/BulkSourceActions";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type ModuleRow = {
  id: string;
  name: string;
  slug: string;
  color: string;
};

export default async function SourcesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const filterModule = typeof params.module === "string" ? params.module : null;

  const [allSources, modulesRaw] = await Promise.all([
    prisma.source.findMany({
      orderBy: [{ popularity: "desc" }, { createdAt: "desc" }],
      include: { modules: { select: { id: true, name: true, slug: true, color: true } } } as never
    }),
    (prisma as unknown as {
      sourceModule: { findMany: (args: unknown) => Promise<ModuleRow[]> };
    }).sourceModule.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }).catch(() => [])
  ]);

  const modules: ModuleRow[] = Array.isArray(modulesRaw) ? modulesRaw : [];

  type SourceWithModules = typeof allSources[number] & { modules?: ModuleRow[]; region?: string };
  const sources = (allSources as SourceWithModules[]).filter((s) => {
    if (!filterModule) return true;
    return s.modules?.some((m) => m.slug === filterModule);
  });
  const sourceIds = sources.map((source) => source.id);
  const recentJobs = sourceIds.length
    ? await prisma.fetchJob.findMany({
        where: {
          sourceId: { in: sourceIds },
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        },
        orderBy: { createdAt: "desc" },
        select: {
          sourceId: true,
          status: true,
          error: true,
          createdAt: true,
          updatedAt: true
        }
      })
    : [];
  const jobsBySource = new Map<string, typeof recentJobs>();
  for (const job of recentJobs) {
    if (!job.sourceId) continue;
    const list = jobsBySource.get(job.sourceId) || [];
    list.push(job);
    jobsBySource.set(job.sourceId, list);
  }

  const toListSource = (s: SourceWithModules): ListSource => ({
    id: s.id,
    name: s.name,
    url: s.url,
    type: s.type,
    status: s.status,
    isDefault: s.isDefault,
    popularity: s.popularity,
    popularityUpdatedAt: s.popularityUpdatedAt?.toISOString() ?? null,
    region: s.region || "UNKNOWN",
    lastJobStatus: jobsBySource.get(s.id)?.[0]?.status ?? null,
    lastJobAt: jobsBySource.get(s.id)?.[0]?.updatedAt.toISOString() ?? null,
    lastJobError: jobsBySource.get(s.id)?.[0]?.error ?? null,
    success7d: jobsBySource.get(s.id)?.filter((job) => job.status === "COMPLETED").length ?? 0,
    failed7d: jobsBySource.get(s.id)?.filter((job) => job.status === "FAILED").length ?? 0
  });

  const infoSources = sources.filter((s) => s.type === "WEB" || s.type === "RSS" || s.type === "EXA");
  const videoSources = sources.filter((s) => s.type === "VIDEO");

  return (
    <AdminShell>
      <p className="eyebrow">Sources</p>
      <h1>信息源与视频源</h1>

      {modules.length > 0 && (
        <div className="topic-tabs">
          <a className={!filterModule ? "active" : ""} href="/admin/sources">
            全部
          </a>
          {modules.map((m) => (
            <a
              key={m.id}
              className={filterModule === m.slug ? "active" : ""}
              href={`/admin/sources?module=${m.slug}`}
              style={{ borderColor: m.color }}
            >
              {m.name}
            </a>
          ))}
        </div>
      )}

      <div className="admin-grid">
        <form className="form-card form-stack" action="/api/admin/sources" method="post">
          <h2>添加信息源</h2>
          <div className="field">
            <label htmlFor="name">名称</label>
            <input id="name" name="name" required placeholder="例如：某新闻站 RSS" />
          </div>
          <div className="field">
            <label htmlFor="url">URL</label>
            <input id="url" name="url" type="url" required placeholder="https://example.com/feed.xml" />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="type">类型</label>
              <select id="type" name="type" defaultValue="WEB">
                <option value="WEB">网页 URL</option>
                <option value="RSS">RSS</option>
                <option value="VIDEO">视频资源</option>
                <option value="EXA">Exa 检索</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="region">地区</label>
              <select id="region" name="region" defaultValue="UNKNOWN">
                <option value="UNKNOWN">未指定</option>
                <option value="DOMESTIC">国内</option>
                <option value="INTERNATIONAL">国外</option>
              </select>
            </div>
          </div>
          {modules.length > 0 && (
            <div className="field">
              <label>所属模块（可多选）</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {modules.map((m) => (
                  <label key={m.id} className="tag" style={{ cursor: "pointer", borderColor: m.color }}>
                    <input type="checkbox" name="moduleIds" value={m.id} style={{ marginRight: 6 }} />
                    {m.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="field">
            <label htmlFor="popularity">知名度（选填，留空将自动估算）</label>
            <input id="popularity" name="popularity" type="number" min="0" placeholder="例如：1200000" />
          </div>
          <label><input type="checkbox" name="isDefault" value="true" /> 设为默认来源</label>
          <button className="button" type="submit">保存来源</button>
        </form>

        <form className="form-card form-stack" action="/api/admin/run" method="post">
          <h2>临时抓取</h2>
          <p>不保存为默认来源，也可以临时添加到本次任务。</p>
          <div className="field">
            <label htmlFor="tempUrl">临时 URL</label>
            <input id="tempUrl" name="tempUrl" type="url" placeholder="https://example.com/news" />
          </div>
          <div className="field">
            <label htmlFor="tempType">类型</label>
            <select id="tempType" name="tempType" defaultValue="WEB">
              <option value="WEB">网页 URL</option>
              <option value="RSS">RSS</option>
              <option value="VIDEO">视频资源</option>
            </select>
          </div>
          <label><input type="checkbox" name="saveTemp" value="true" /> 保存为默认来源</label>
          <button className="button" type="submit">抓取临时来源</button>
        </form>

        <form className="form-card form-stack" action="/api/admin/run" method="post">
          <h2>关键词写新闻</h2>
          <p>输入选题后，系统会先搜索资料，再生成新闻草稿。</p>
          <div className="field">
            <label htmlFor="keyword">关键词或选题</label>
            <input id="keyword" name="keyword" required placeholder="例如：电动汽车价格战 / OpenAI 新模型" />
          </div>
          <div className="field">
            <label htmlFor="keywordScope">搜索范围</label>
            <select id="keywordScope" name="keywordScope" defaultValue="all">
              <option value="all">国内 + 国外</option>
              <option value="domestic">国内来源</option>
              <option value="international">国外来源</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="articleCount">生成篇数</label>
            <input id="articleCount" name="articleCount" type="number" min="1" max="5" defaultValue="1" />
          </div>
          <div className="field">
            <label htmlFor="articleDepth">报道长度</label>
            <select id="articleDepth" name="articleDepth" defaultValue="long">
              <option value="standard">标准报道（至少 1100 字，目标 1200）</option>
              <option value="long">长报道（至少 1900 字，目标 2000）</option>
              <option value="deep">深度报道（至少 3000 字，目标 3200）</option>
            </select>
          </div>
          <button className="button" type="submit">搜索资料并写新闻草稿</button>
        </form>
      </div>

      <BulkSourceActions sources={infoSources.map(toListSource)} label="信息源" />
      <BulkSourceActions sources={videoSources.map(toListSource)} label="视频源" />
    </AdminShell>
  );
}
