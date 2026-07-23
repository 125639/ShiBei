import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { I18nText } from "@/components/I18nText";
import { AutoCurationTopicsClient } from "@/components/AutoCurationTopicsClient";
import { SubmitButton } from "@/components/SubmitButton";
import { requireAdmin } from "@/lib/auth";
import { CONTENT_LANGUAGE_MODE_OPTIONS } from "@/lib/language";
import { formatDateTime } from "@/lib/job-utils";
import { prisma } from "@/lib/prisma";
import { displayModeOptions } from "@/lib/topics";

export const dynamic = "force-dynamic";

export default async function AutoCurationPage() {
  await requireAdmin();
  const [site, topics, styles, modules, recentRuns] = await Promise.all([
    prisma.siteSettings.findUnique({ where: { id: "site" } }),
    prisma.contentTopic.findMany({
      orderBy: { createdAt: "asc" },
      include: { schedule: true, style: true, modules: { select: { id: true, name: true } } }
    }),
    prisma.contentStyle.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.sourceModule.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, color: true }
    }),
    prisma.fetchJob.findMany({
      where: { contentTopicId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { contentTopic: { select: { name: true } } }
    })
  ]);

  const topicItems = topics.map((topic) => ({
    id: topic.id,
    name: topic.name,
    slug: topic.slug,
    keywords: topic.keywords,
    scope: topic.scope,
    compileKind: topic.compileKind,
    depth: topic.depth,
    articleCount: topic.articleCount,
    styleId: topic.styleId,
    styleName: topic.style?.name || null,
    isEnabled: topic.isEnabled,
    useExa: topic.useExa,
    moduleIds: topic.modules.map((module) => module.id),
    moduleNames: topic.modules.map((module) => module.name),
    scheduleCron: topic.schedule?.cron || "0 9 * * *",
    lastRunLabel: formatDateTime(topic.schedule?.lastRunAt),
    nextRunLabel: formatDateTime(topic.schedule?.nextRunAt)
  }));
  const styleOptions = styles.map((style) => ({
    id: style.id,
    name: style.name,
    tone: style.tone
  }));

  return (
    <AdminShell>
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">Content Automation</p>
          <h1><I18nText zh="自动内容生产" en="Auto Curation" /></h1>
        </div>
      </div>
      <p className="muted">
        <I18nText
          zh="管理员配置主题、关键词、生成风格和定时表后,worker 会按计划整理资料并生成博客草稿。可在站点设置开启「自动发布」,让产物直接上线。"
          en="Configure topics, keywords, styles and schedules — the worker gathers material and drafts posts on schedule. Enable auto-publish in Settings to push results live directly."
        />
      </p>

      <form className="form-card form-stack" action="/api/admin/settings/auto-curation" method="post" style={{ marginBottom: 24 }}>
        <h2><I18nText zh="全局开关" en="Global Switch" /></h2>
        <label>
          <input
            type="checkbox"
            name="autoCurationEnabled"
            value="true"
            defaultChecked={site?.autoCurationEnabled ?? false}
          />{" "}
          <I18nText zh="启用自动内容生产" en="Enable auto curation" />
        </label>
        <p className="muted"><I18nText zh="关闭后，定时任务仍会触发但会立即跳过；不会产生新文章。单个主题可在主题设置中单独启停。" en="When off, scheduled runs fire but skip immediately — no new posts. Each topic can also be toggled individually." /></p>

        <div className="field-row">
          <div className="field">
            <label htmlFor="contentDisplayMode"><I18nText zh="公开站内容显示方式" en="Public content layout" /></label>
            <select
              id="contentDisplayMode"
              name="contentDisplayMode"
              defaultValue={site?.contentDisplayMode || "grid"}
            >
              {displayModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="contentLanguageModeAuto"><I18nText zh="内容语言模式" en="Content language mode" /></label>
            <select
              id="contentLanguageModeAuto"
              name="contentLanguageMode"
              defaultValue={(site as { contentLanguageMode?: string } | null)?.contentLanguageMode || "default-language"}
            >
              {CONTENT_LANGUAGE_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        <SubmitButton pendingLabel={<I18nText zh="保存中…" en="Saving…" />}><I18nText zh="保存全局设置" en="Save Global Settings" /></SubmitButton>
      </form>

      <AutoCurationTopicsClient topics={topicItems} styles={styleOptions} modules={modules} />

      <section className="admin-panel" style={{ marginTop: 24 }}>
        <h2><I18nText zh="最近自动内容任务" en="Recent Auto-Curation Jobs" /></h2>
        {recentRuns.length === 0 ? (
          <p className="muted"><I18nText zh="还没有任务。启用一个主题后，下一次定时点会出现在这里。" en="No jobs yet. Enable a topic and its next run will show up here." /></p>
        ) : (
          <div className="table-list">
            {recentRuns.map((job) => (
              <div className="table-item" key={job.id}>
                <div>
                  <strong>{job.contentTopic?.name || "—"}</strong>
                  <div className="muted">{job.createdAt.toLocaleString("zh-CN")} · {job.sourceUrl.slice(0, 80)}</div>
                  {job.error ? <p className="muted"><I18nText zh="错误：" en="Error: " />{job.error}</p> : null}
                </div>
                <span className="tag">{job.status}</span>
              </div>
            ))}
          </div>
        )}
        <p className="muted" style={{ marginTop: 8 }}>
          <I18nText zh="查看更详细的任务状态请访问 " en="For detailed job status see the " /><Link className="text-link" href="/admin"><I18nText zh="仪表盘" en="dashboard" /></Link>。
        </p>
      </section>
    </AdminShell>
  );
}
