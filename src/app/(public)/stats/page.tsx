import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BarChart, DonutChart, LineChart, StackedBarChart } from "@/components/Charts";
import { I18nText } from "@/components/I18nText";
import { prisma } from "@/lib/prisma";
import { loadCachedStats, type StatsWindow } from "@/lib/stats";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "数据看板",
  description: "文章收录的实时统计与趋势图表。",
  alternates: { canonical: "/stats" }
};

const VALID: StatsWindow[] = ["today", "week", "total"];

const WINDOW_LABELS: Record<StatsWindow, { zh: string; en: string }> = {
  today: { zh: "当天", en: "today" },
  week: { zh: "本周", en: "this week" },
  total: { zh: "总计", en: "all time" }
};

export default async function StatsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requested = typeof params.window === "string" ? params.window : "week";
  const window: StatsWindow = (VALID as string[]).includes(requested) ? (requested as StatsWindow) : "week";
  const [stats, settings] = await Promise.all([
    loadCachedStats(window),
    prisma.siteSettings.findUnique({ where: { id: "site" }, select: { videosEnabled: true } }).catch(() => null)
  ]);
  // 视频功能关闭时前台完全不出现视频，统计页也不该再展示视频指标。
  const showVideos = settings?.videosEnabled === true;

  return (
    <main className="container bento-page public-list-page stats-page">
      <section className="page-intro bento-card bento-wide">
        <p className="eyebrow">Statistics</p>
        <h1 className="page-title"><I18nText zh="数据看板" en="Statistics" /></h1>
        <p className="muted-block">
          <I18nText
            zh={showVideos ? "实时统计收录的文章与视频。该数据每分钟刷新一次缓存。" : "实时统计收录的文章。该数据每分钟刷新一次缓存。"}
            en={showVideos ? "Live counts of curated posts and videos, cached for one minute." : "Live counts of curated posts, cached for one minute."}
          />
        </p>
      </section>

      {/* 这是链接导航而非 tab 控件：用 aria-current 表达当前项，避免 role=tab 的键盘语义负担。 */}
      <nav className="topic-tabs" aria-label="时间窗口">
        {([
          { key: "today", zh: "当天", en: "Today" },
          { key: "week", zh: "本周（7 天）", en: "This week (7d)" },
          { key: "total", zh: "全部", en: "All time" }
        ] as const).map((tab) => (
          <Link
            key={tab.key}
            aria-current={window === tab.key ? "page" : undefined}
            className={window === tab.key ? "active" : ""}
            href={`/stats?window=${tab.key}`}
          >
            <I18nText zh={tab.zh} en={tab.en} />
          </Link>
        ))}
      </nav>

      <div className="bento-grid stats-metric-bento">
        <Metric label={<I18nText zh="文章 · 当天" en="Posts · Today" />} value={stats.todayNews} />
        <Metric label={<I18nText zh="文章 · 本周" en="Posts · Week" />} value={stats.weekNews} />
        <Metric label={<I18nText zh="文章 · 总数" en="Posts · Total" />} value={stats.totals.news} />
        {showVideos ? (
          <>
            <Metric label={<I18nText zh="视频 · 当天" en="Videos · Today" />} value={stats.todayVideos} />
            <Metric label={<I18nText zh="视频 · 本周" en="Videos · Week" />} value={stats.weekVideos} />
            <Metric label={<I18nText zh="视频 · 总数" en="Videos · Total" />} value={stats.totals.videos} />
          </>
        ) : null}
      </div>

      <div className="bento-grid chart-bento">
        <div className="chart-card bento-card bento-wide">
          <h3><I18nText zh={`文章数量（按日，近 ${stats.newsBuckets.length} 天）`} en={`Posts per day (last ${stats.newsBuckets.length} days)`} /></h3>
          <BarChart buckets={stats.newsBuckets} ariaLabel="按日文章柱状图" />
        </div>
        {showVideos ? (
          <>
            <div className="chart-card bento-card bento-wide">
              <h3><I18nText zh={`视频数量（按日，近 ${stats.videoBuckets.length} 天）`} en={`Videos per day (last ${stats.videoBuckets.length} days)`} /></h3>
              <LineChart buckets={stats.videoBuckets} ariaLabel="按日视频折线图" />
            </div>
            <div className="chart-card bento-card bento-wide">
              <h3><I18nText zh="文章 vs 视频（堆叠对比）" en="Posts vs videos (stacked)" /></h3>
              <StackedBarChart
                primary={stats.newsBuckets}
                secondary={stats.videoBuckets}
                ariaLabel="文章视频对比"
              />
            </div>
          </>
        ) : null}
        <div className="chart-card bento-card">
          <h3><I18nText zh={`文章分类占比（${WINDOW_LABELS[window].zh}）`} en={`Topic share (${WINDOW_LABELS[window].en})`} /></h3>
          <DonutChart slices={stats.topicSlices} ariaLabel="文章分类环形图" />
        </div>
        <div className="chart-card bento-card">
          <h3><I18nText zh="当天 24 小时分布" en="Today by hour" /></h3>
          <BarChart
            buckets={stats.hourBuckets}
            showAllLabels={false}
            ariaLabel="今天每小时文章分布"
            color="var(--chart-3)"
          />
        </div>
        <div className="chart-card bento-card">
          <h3><I18nText zh="分类详情" en="Topic details" /></h3>
          {stats.topicSlices.length === 0 ? (
            <p className="muted">
              <I18nText
                zh="暂无分类数据。先在管理后台添加 ContentTopic 与已发布文章。"
                en="No topic data yet. Add content topics and published posts in the admin console first."
              />
            </p>
          ) : (
            <TopicBreakdown slices={stats.topicSlices} />
          )}
        </div>
      </div>

      <p className="muted" style={{ marginTop: 24, fontSize: 13 }}>
        <I18nText zh="生成于" en="Generated at" />{" "}
        <time dateTime={new Date(stats.generatedAt).toISOString()}>
          <I18nText
            zh={new Date(stats.generatedAt).toLocaleString("zh-CN")}
            en={new Date(stats.generatedAt).toLocaleString("en-US")}
          />
        </time>
      </p>
    </main>
  );
}

function Metric({ label, value }: { label: ReactNode; value: number }) {
  return (
    <div className="metric-card bento-card">
      <div className="bento-kpi">{value}</div>
      <div className="muted" style={{ fontSize: 13 }}>
        {label}
      </div>
    </div>
  );
}

/**
 * 分类详情：名称 + 计数 + 占比条。
 * `_other` 是「其余分类合并」的内部聚合 id，不是真实 slug，不对外展示；
 * 真实分类的 slug 也只是内部路由标识，列表里同样省去，版式更干净。
 */
function TopicBreakdown({ slices }: { slices: { id: string; name: string; slug: string; count: number }[] }) {
  const total = slices.reduce((acc, s) => acc + s.count, 0);
  const max = Math.max(...slices.map((s) => s.count), 1);

  return (
    <ul className="topic-breakdown">
      {slices.map((s) => {
        const isAggregate = s.id === "_other";
        const percent = total > 0 ? Math.round((s.count / total) * 100) : 0;
        const name = isAggregate ? <I18nText zh="其他" en="Others" /> : s.name;
        return (
          <li key={s.id} className="topic-breakdown-item">
            <div className="topic-breakdown-head">
              <span className="topic-breakdown-name">
                {isAggregate ? (
                  name
                ) : (
                  <Link className="topic-breakdown-link" href={`/posts?topic=${encodeURIComponent(s.slug)}`}>
                    {name}
                  </Link>
                )}
              </span>
              <span className="topic-breakdown-count">
                {s.count} <I18nText zh="篇" en="posts" /> · {percent}%
              </span>
            </div>
            <div
              className="topic-breakdown-meter"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={max}
              aria-valuenow={s.count}
              aria-label={`${isAggregate ? "其他" : s.name}：${s.count} 篇`}
            >
              <span style={{ width: `${Math.max((s.count / max) * 100, 2)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
