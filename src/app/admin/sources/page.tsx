import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { BulkSourceActions, type ListSource } from "@/components/BulkSourceActions";
import { ContentStyleSelect } from "@/components/ContentStyleSelect";
import { I18nText } from "@/components/I18nText";
import { SubmitButton } from "@/components/SubmitButton";
import { VideoAttachModeSelect } from "@/components/VideoAttachModeSelect";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type ModuleRow = {
  id: string;
  name: string;
  slug: string;
  color: string;
};

async function getSevenDayWindowStart() {
  const [row] = await prisma.$queryRaw<Array<{ since: Date }>>`
    SELECT CURRENT_TIMESTAMP - INTERVAL '7 days' AS "since"
  `;
  return row.since;
}

export default async function SourcesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const filterModule = typeof params.module === "string" ? params.module : null;

  const [allSources, modulesRaw, contentStyles] = await Promise.all([
    prisma.source.findMany({
      orderBy: [{ popularity: "desc" }, { createdAt: "desc" }],
      include: { modules: { select: { id: true, name: true, slug: true, color: true } } } as never
    }),
    (prisma as unknown as {
      sourceModule: { findMany: (args: unknown) => Promise<ModuleRow[]> };
    }).sourceModule.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }).catch(() => []),
    prisma.contentStyle.findMany({ orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] })
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
          createdAt: { gte: await getSevenDayWindowStart() }
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
    failed7d: jobsBySource.get(s.id)?.filter((job) => job.status === "FAILED").length ?? 0,
    failStreak: (s as { failStreak?: number }).failStreak ?? 0
    ,moduleIds: (s.modules || []).map((module) => module.id)
  });

  const infoSources = sources.filter((s) => s.type === "WEB" || s.type === "RSS" || s.type === "EXA");
  const videoSources = sources.filter((s) => s.type === "VIDEO");

  return (
    <AdminShell>
      <p className="eyebrow">Sources</p>
      <h1><I18nText zh="信息源与视频源" en="Information & Video Sources" /></h1>

      {modules.length > 0 && (
        <div className="topic-tabs">
          <Link className={!filterModule ? "active" : ""} href="/admin/sources" aria-current={!filterModule ? "page" : undefined}>
            <I18nText zh="全部" en="All" />
          </Link>
          {modules.map((m) => (
            <Link
              key={m.id}
              className={filterModule === m.slug ? "active" : ""}
              aria-current={filterModule === m.slug ? "page" : undefined}
              href={`/admin/sources?module=${m.slug}`}
              style={{ borderColor: m.color }}
            >
              {m.name}
            </Link>
          ))}
        </div>
      )}

      {filterModule && sources.length === 0 ? (
        <p className="muted-block">
          <I18nText
            zh={`模块「${modules.find((m) => m.slug === filterModule)?.name || filterModule}」下还没有信息源。`}
            en={`No sources in module "${modules.find((m) => m.slug === filterModule)?.name || filterModule}" yet.`}
          />{" "}
          <Link className="text-link" href="/admin/sources"><I18nText zh="查看全部来源" en="View all sources" /></Link>
        </p>
      ) : null}

      <div className="admin-grid">
        <form className="form-card form-stack" action="/api/admin/sources" method="post">
          <h2><I18nText zh="添加信息源" en="Add Source" /></h2>
          <div className="field">
            <label htmlFor="name"><I18nText zh="名称" en="Name" /></label>
            <input id="name" name="name" required placeholder="例如：某博客 RSS / 行业站点" />
          </div>
          <div className="field">
            <label htmlFor="url">URL</label>
            <input id="url" name="url" type="url" required placeholder="https://example.com/feed.xml" />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="type"><I18nText zh="类型" en="Type" /></label>
              <select id="type" name="type" defaultValue="WEB">
                <option value="WEB">网页 URL / Web URL</option>
                <option value="RSS">RSS</option>
                <option value="VIDEO">视频资源 / Video</option>
                <option value="EXA">Exa 检索 / Exa Search</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="region"><I18nText zh="地区" en="Region" /></label>
              <select id="region" name="region" defaultValue="UNKNOWN">
                <option value="UNKNOWN">未指定 / Unknown</option>
                <option value="DOMESTIC">国内 / Domestic</option>
                <option value="INTERNATIONAL">国外 / International</option>
              </select>
            </div>
          </div>
          {modules.length > 0 && (
            <div className="field">
              <label><I18nText zh="所属模块（可多选）" en="Modules (multiple)" /></label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {modules.map((m) => (
                  <label key={m.id} className="tag" style={{ "--tag-accent": m.color } as React.CSSProperties}>
                    <input type="checkbox" name="moduleIds" value={m.id} />
                    {m.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="field">
            <label htmlFor="popularity"><I18nText zh="知名度（选填，留空将自动估算）" en="Popularity (optional, auto-estimated if empty)" /></label>
            <input id="popularity" name="popularity" type="number" min="0" placeholder="例如：1200000" />
          </div>
          <label><input type="checkbox" name="isDefault" value="true" /> <I18nText zh="设为默认来源" en="Set as default source" /></label>
          <SubmitButton pendingLabel={<I18nText zh="保存中…" en="Saving…" />}><I18nText zh="保存来源" en="Save Source" /></SubmitButton>
        </form>

        <form className="form-card form-stack" action="/api/admin/run" method="post">
          <h2><I18nText zh="临时抓取" en="Temporary Fetch" /></h2>
          <p><I18nText zh="不保存为默认来源，也可以临时添加到本次任务。" en="Fetch without saving as default source." /></p>
          <div className="field">
            <label htmlFor="tempUrl"><I18nText zh="临时 URL" en="Temporary URL" /></label>
            <input id="tempUrl" name="tempUrl" type="url" placeholder="https://example.com/posts" />
          </div>
          <div className="field">
            <label htmlFor="tempType"><I18nText zh="类型" en="Type" /></label>
            <select id="tempType" name="tempType" defaultValue="WEB">
              <option value="WEB">网页 URL / Web URL</option>
              <option value="RSS">RSS</option>
              <option value="VIDEO">视频资源 / Video</option>
            </select>
          </div>
          <label><input type="checkbox" name="saveTemp" value="true" /> <I18nText zh="保存为默认来源" en="Save as default source" /></label>
          <ContentStyleSelect styles={contentStyles} id="tempContentStyleId" />
          <VideoAttachModeSelect id="tempVideoAttachMode" />
          <SubmitButton pendingLabel={<I18nText zh="正在创建任务…" en="Creating job…" />}><I18nText zh="抓取临时来源" en="Fetch Temporary Source" /></SubmitButton>
        </form>

        <form className="form-card form-stack" action="/api/admin/run" method="post">
          <h2><I18nText zh="关键词生成文章" en="Generate Article from Keywords" /></h2>
          <p><I18nText zh="输入选题后，系统会先搜索资料，再按选定风格生成文章草稿。" en="Enter a topic and the system will search for materials and generate an article draft." /></p>
          <div className="field">
            <label htmlFor="keyword"><I18nText zh="关键词或选题" en="Keywords or Topic" /></label>
            <input id="keyword" name="keyword" required placeholder="例如：电动汽车价格战 / OpenAI 新模型" />
          </div>
          <div className="field">
            <label htmlFor="keywordScope"><I18nText zh="搜索范围" en="Search Scope" /></label>
            <select id="keywordScope" name="keywordScope" defaultValue="all">
              <option value="all">国内 + 国外 / Domestic + International</option>
              <option value="domestic">国内来源 / Domestic Sources</option>
              <option value="international">国外来源 / International Sources</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="articleCount"><I18nText zh="生成篇数" en="Number of Articles" /></label>
            <input id="articleCount" name="articleCount" type="number" min="1" max="5" defaultValue="1" />
          </div>
          <div className="field">
            <label htmlFor="articleDepth"><I18nText zh="文章长度" en="Article Length" /></label>
            <select id="articleDepth" name="articleDepth" defaultValue="long">
              <option value="standard">标准文章（至少 1100 字，目标 1200） / Standard (min 1100 words, target 1200)</option>
              <option value="long">长文章（至少 1900 字，目标 2000） / Long (min 1900 words, target 2000)</option>
              <option value="deep">深度长文（至少 3000 字，目标 3200） / Deep (min 3000 words, target 3200)</option>
            </select>
          </div>
          <ContentStyleSelect styles={contentStyles} id="sourceKeywordContentStyleId" />
          <VideoAttachModeSelect id="sourceKeywordVideoAttachMode" />
          <SubmitButton pendingLabel={<I18nText zh="正在创建任务…" en="Creating job…" />}><I18nText zh="搜索资料并生成文章草稿" en="Search & Generate Draft" /></SubmitButton>
        </form>
      </div>

      <BulkSourceActions sources={infoSources.map(toListSource)} modules={modules} label="信息源" />
      <BulkSourceActions sources={videoSources.map(toListSource)} modules={modules} label="视频源" />
    </AdminShell>
  );
}
