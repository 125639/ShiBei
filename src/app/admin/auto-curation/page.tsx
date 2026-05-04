import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { requireAdmin } from "@/lib/auth";
import { NEWS_LANGUAGE_MODE_OPTIONS } from "@/lib/language";
import { prisma } from "@/lib/prisma";
import { displayModeOptions } from "@/lib/topics";
import { researchScopeLabel, type ResearchScope } from "@/lib/research";

const COMPILE_KIND_LABELS: Record<string, string> = {
  SINGLE_ARTICLE: "单篇报道",
  DAILY_DIGEST: "每日要闻",
  WEEKLY_ROUNDUP: "周报综述"
};

function formatDateTime(value: Date | null | undefined) {
  if (!value) return "—";
  return value.toLocaleString("zh-CN");
}

export default async function AutoCurationPage() {
  await requireAdmin();
  const [site, topics, styles, recentRuns] = await Promise.all([
    prisma.siteSettings.findUnique({ where: { id: "site" } }),
    prisma.newsTopic.findMany({
      orderBy: { createdAt: "asc" },
      include: { schedule: true, style: true }
    }),
    prisma.summaryStyle.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.fetchJob.findMany({
      where: { newsTopicId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { newsTopic: true }
    })
  ]);

  return (
    <AdminShell>
      <p className="eyebrow">Auto Curation</p>
      <h1>自动整理</h1>
      <p className="muted">
        管理员配置主题、关键词和定时表后，worker 会按计划自动抓取整理并发布。可在站点设置开启 *自动发布*，让产物直接上线，无需审核。
      </p>

      <div className="admin-grid">
        <form className="form-card form-stack" action="/api/admin/settings/auto-curation" method="post">
          <h2>全局开关</h2>
          <label>
            <input
              type="checkbox"
              name="autoCurationEnabled"
              value="true"
              defaultChecked={site?.autoCurationEnabled ?? false}
            />{" "}
            启用自动整理
          </label>
          <p className="muted">关闭后，定时任务仍会触发但会立即跳过；不会产生新文章。单个主题的开关在下方表格里。</p>

          <div className="field">
            <label htmlFor="newsDisplayMode">公开站新闻显示方式</label>
            <select
              id="newsDisplayMode"
              name="newsDisplayMode"
              defaultValue={site?.newsDisplayMode || "grid"}
            >
              {displayModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="muted">
              {displayModeOptions.map((option) => `${option.label}：${option.description}`).join("　")}
            </p>
          </div>

          <div className="field">
            <label htmlFor="newsLanguageModeAuto">新闻语言模式</label>
            <select
              id="newsLanguageModeAuto"
              name="newsLanguageMode"
              defaultValue={(site as { newsLanguageMode?: string } | null)?.newsLanguageMode || "default-language"}
            >
              {NEWS_LANGUAGE_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="muted">
              {NEWS_LANGUAGE_MODE_OPTIONS.map((option) => `${option.label}：${option.description}`).join("　")}
            </p>
          </div>

          <button className="button" type="submit">保存全局设置</button>
        </form>

        <form className="form-card form-stack" action="/api/admin/topics" method="post">
          <h2>添加新主题</h2>
          <div className="field">
            <label htmlFor="topicName">主题名称</label>
            <input id="topicName" name="name" required placeholder="例如：财经周报" />
          </div>
          <div className="field">
            <label htmlFor="topicSlug">Slug（URL 标识）</label>
            <input id="topicSlug" name="slug" required placeholder="例如：finance-weekly" pattern="[a-z0-9-]+" />
          </div>
          <div className="field">
            <label htmlFor="topicScope">报道范围</label>
            <select id="topicScope" name="scope" defaultValue="all">
              <option value="all">国内 + 国外</option>
              <option value="domestic">仅国内</option>
              <option value="international">仅国外</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="topicKeywords">关键词（每行一个，最多 8 个）</label>
            <textarea id="topicKeywords" name="keywords" rows={4} required placeholder="人工智能&#10;芯片&#10;新能源" />
          </div>
          <div className="field">
            <label htmlFor="topicCompileKind">产出形式</label>
            <select id="topicCompileKind" name="compileKind" defaultValue="SINGLE_ARTICLE">
              <option value="SINGLE_ARTICLE">单篇报道（每个关键词产 1~N 篇）</option>
              <option value="DAILY_DIGEST">每日要闻（24h 内多源汇总成 1 篇）</option>
              <option value="WEEKLY_ROUNDUP">周报综述（7d 内多源汇总成 1 篇）</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="topicDepth">单篇报道长度</label>
            <select id="topicDepth" name="depth" defaultValue="long">
              <option value="standard">标准报道（约 1200 字）</option>
              <option value="long">长报道（约 2000 字）</option>
              <option value="deep">深度报道（约 3200 字）</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="topicArticleCount">单篇报道篇数（仅单篇模式）</label>
            <input id="topicArticleCount" name="articleCount" type="number" min="1" max="5" defaultValue="1" />
          </div>
          <div className="field">
            <label htmlFor="topicStyle">总结风格</label>
            <select id="topicStyle" name="styleId" defaultValue="">
              <option value="">使用默认风格</option>
              {styles.map((style) => (
                <option key={style.id} value={style.id}>{style.name}（{style.tone}）</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="topicCron">定时表 cron（5 字段）</label>
            <input id="topicCron" name="cron" required defaultValue="0 9 * * *" placeholder="例如：0 9 * * * 表示每天 09:00" />
            <p className="muted">分 时 日 月 周。例：<code>0 9 * * *</code> 每天 09:00；<code>0 */6 * * *</code> 每 6 小时；<code>0 9 * * 1</code> 每周一 09:00。</p>
          </div>
          <label>
            <input type="checkbox" name="isEnabled" value="true" defaultChecked /> 立即启用此主题
          </label>
          <button className="button" type="submit">保存主题</button>
        </form>
      </div>

      <section className="admin-panel" style={{ marginTop: 18 }}>
        <h2>已配置主题</h2>
        {topics.length === 0 ? (
          <p className="muted">暂无主题。运行 <code>npm run db:seed</code> 可一次性创建 10 个默认主题（默认全部关闭）。</p>
        ) : (
          <div className="table-list">
            {topics.map((topic) => {
              const scope = (topic.scope as ResearchScope) || "all";
              const keywordsPreview = topic.keywords.split(/\n|,|，/).slice(0, 4).filter(Boolean).join(" / ");
              return (
                <div className="table-item" key={topic.id} style={{ display: "block" }}>
                  <div className="meta-row">
                    <strong>{topic.name}</strong>
                    <span className="tag">{COMPILE_KIND_LABELS[topic.compileKind] || topic.compileKind}</span>
                    <span className="tag">{researchScopeLabel(scope)}</span>
                    <span className="tag">{topic.isEnabled ? "已启用" : "已停用"}</span>
                  </div>
                  <div className="muted">
                    Slug：<code>{topic.slug}</code> · 关键词：{keywordsPreview || "（未填）"} ·
                    Cron：<code>{topic.schedule?.cron || "未设置"}</code> ·
                    上次：{formatDateTime(topic.schedule?.lastRunAt)} ·
                    风格：{topic.style?.name || "默认"}
                  </div>
                  <form action={`/api/admin/topics/${topic.id}`} method="post" className="form-stack" style={{ marginTop: 12 }}>
                    <div className="field">
                      <label>主题名</label>
                      <input name="name" defaultValue={topic.name} required />
                    </div>
                    <div className="field">
                      <label>关键词（每行一个）</label>
                      <textarea name="keywords" rows={3} defaultValue={topic.keywords} required />
                    </div>
                    <div className="field">
                      <label>报道范围</label>
                      <select name="scope" defaultValue={topic.scope}>
                        <option value="all">国内 + 国外</option>
                        <option value="domestic">仅国内</option>
                        <option value="international">仅国外</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>产出形式</label>
                      <select name="compileKind" defaultValue={topic.compileKind}>
                        <option value="SINGLE_ARTICLE">单篇报道</option>
                        <option value="DAILY_DIGEST">每日要闻</option>
                        <option value="WEEKLY_ROUNDUP">周报综述</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>单篇长度</label>
                      <select name="depth" defaultValue={topic.depth}>
                        <option value="standard">标准</option>
                        <option value="long">长报道</option>
                        <option value="deep">深度报道</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>篇数（仅单篇模式）</label>
                      <input name="articleCount" type="number" min="1" max="5" defaultValue={topic.articleCount} />
                    </div>
                    <div className="field">
                      <label>风格</label>
                      <select name="styleId" defaultValue={topic.styleId || ""}>
                        <option value="">使用默认风格</option>
                        {styles.map((style) => (
                          <option key={style.id} value={style.id}>{style.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>Cron</label>
                      <input name="cron" defaultValue={topic.schedule?.cron || "0 9 * * *"} required />
                    </div>
                    <label>
                      <input type="checkbox" name="isEnabled" value="true" defaultChecked={topic.isEnabled} />{" "}
                      启用此主题
                    </label>
                    <div className="meta-row" style={{ gap: 8 }}>
                      <button className="button" type="submit">保存</button>
                      <button className="button" type="submit" formAction={`/api/admin/topics/${topic.id}/run`}>立即试运行</button>
                      <button className="button" type="submit" formAction={`/api/admin/topics/${topic.id}/delete`}>删除主题</button>
                    </div>
                  </form>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="admin-panel" style={{ marginTop: 18 }}>
        <h2>最近自动整理任务</h2>
        {recentRuns.length === 0 ? (
          <p className="muted">还没有任务。启用一个主题后，下一次定时点会出现在这里。</p>
        ) : (
          <div className="table-list">
            {recentRuns.map((job) => (
              <div className="table-item" key={job.id}>
                <div>
                  <strong>{job.newsTopic?.name || "未知主题"}</strong>
                  <div className="muted">{job.createdAt.toLocaleString("zh-CN")} · {job.sourceUrl.slice(0, 80)}</div>
                  {job.error ? <p className="muted">错误：{job.error}</p> : null}
                </div>
                <span className="tag">{job.status}</span>
              </div>
            ))}
          </div>
        )}
        <p className="muted" style={{ marginTop: 8 }}>
          查看更详细的任务状态请访问 <Link className="text-link" href="/admin">仪表盘</Link>。
        </p>
      </section>
    </AdminShell>
  );
}
