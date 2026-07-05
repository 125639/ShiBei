import Link from "next/link";
import type { Metadata } from "next";
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
    <main className="container bento-page">
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
        <Metric label="文章 · 当天" value={stats.todayNews} />
        <Metric label="文章 · 本周" value={stats.weekNews} />
        <Metric label="文章 · 总数" value={stats.totals.news} />
        {showVideos ? (
          <>
            <Metric label="视频 · 当天" value={stats.todayVideos} />
            <Metric label="视频 · 本周" value={stats.weekVideos} />
            <Metric label="视频 · 总数" value={stats.totals.videos} />
          </>
        ) : null}
      </div>

      <div className="bento-grid chart-bento">
        <div className="chart-card bento-card bento-wide">
          <h3>文章数量（按日，近 {stats.newsBuckets.length} 天）</h3>
          <BarChart buckets={stats.newsBuckets} ariaLabel="按日文章柱状图" />
        </div>
        {showVideos ? (
          <>
            <div className="chart-card bento-card bento-wide">
              <h3>视频数量（按日，近 {stats.videoBuckets.length} 天）</h3>
              <LineChart buckets={stats.videoBuckets} ariaLabel="按日视频折线图" />
            </div>
            <div className="chart-card bento-card bento-wide">
              <h3>文章 vs 视频（堆叠对比）</h3>
              <StackedBarChart
                primary={stats.newsBuckets}
                secondary={stats.videoBuckets}
                ariaLabel="文章视频对比"
              />
            </div>
          </>
        ) : null}
        <div className="chart-card bento-card">
          <h3>文章分类占比（{labelOf(window)}）</h3>
          <DonutChart slices={stats.topicSlices} ariaLabel="文章分类环形图" />
        </div>
        <div className="chart-card bento-card">
          <h3>当天 24 小时分布</h3>
          <BarChart
            buckets={stats.hourBuckets}
            showAllLabels={false}
            ariaLabel="今天每小时文章分布"
            color="var(--chart-3)"
          />
        </div>
        <div className="chart-card bento-card">
          <h3>分类详情</h3>
          {stats.topicSlices.length === 0 ? (
            <p className="muted">暂无分类数据。先在管理后台添加 ContentTopic 与已发布文章。</p>
          ) : (
            <ul className="news-list">
              {stats.topicSlices.map((s) => (
                <li key={s.id} className="news-list-item" style={{ padding: "12px 0" }}>
                  <span className="timeline-dot" />
                  <div style={{ flex: 1 }}>
                    <strong>{s.name}</strong>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {s.slug} · {s.count} 篇
                    </div>
                  </div>
                  <span className="tag">{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="muted" style={{ marginTop: 24, fontSize: 13 }}>
        <I18nText zh="生成于" en="Generated at" />{" "}
        <time dateTime={new Date(stats.generatedAt).toISOString()}>
          {new Date(stats.generatedAt).toLocaleString("zh-CN")}
        </time>
      </p>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-card bento-card">
      <div className="bento-kpi">{value}</div>
      <div className="muted" style={{ fontSize: 13 }}>
        {label}
      </div>
    </div>
  );
}

function labelOf(window: StatsWindow) {
  return window === "today" ? "当天" : window === "week" ? "本周" : "总计";
}
