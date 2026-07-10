import { AdminShell } from "@/components/AdminShell";
import { BarChart, DonutChart, LineChart, StackedBarChart } from "@/components/Charts";
import { I18nText } from "@/components/I18nText";
import { MetricCard } from "@/components/MetricCard";
import { requireAdmin } from "@/lib/auth";
import { loadStats } from "@/lib/stats";
import { loadVisitStats } from "@/lib/visits";

export const dynamic = "force-dynamic";

export default async function AdminStatsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const requested = typeof params.window === "string" ? params.window : "week";
  const window = requested === "today" || requested === "week" || requested === "total" ? requested : "week";
  const [stats, visits] = await Promise.all([
    loadStats(window as "today" | "week" | "total"),
    loadVisitStats()
  ]);

  return (
    <AdminShell>
      <p className="eyebrow">Statistics</p>
      <h1><I18nText zh="数据看板" en="Statistics" /></h1>

      <div className="topic-tabs">
        {(["today", "week", "total"] as const).map((tab) => (
          <a
            key={tab}
            className={window === tab ? "active" : ""}
            href={`/admin/stats?window=${tab}`}
          >
            {tab === "today" ? (
              <I18nText zh="当天" en="Today" />
            ) : tab === "week" ? (
              <I18nText zh="本周" en="This week" />
            ) : (
              <I18nText zh="全部" en="All time" />
            )}
          </a>
        ))}
      </div>

      <div className="admin-grid-3">
        <MetricCard label={<I18nText zh="文章 · 当天" en="Posts · Today" />} value={stats.todayNews} />
        <MetricCard label={<I18nText zh="文章 · 本周" en="Posts · Week" />} value={stats.weekNews} />
        <MetricCard label={<I18nText zh="文章 · 总计" en="Posts · Total" />} value={stats.totals.news} />
        <MetricCard label={<I18nText zh="视频 · 当天" en="Videos · Today" />} value={stats.todayVideos} />
        <MetricCard label={<I18nText zh="视频 · 本周" en="Videos · Week" />} value={stats.weekVideos} />
        <MetricCard label={<I18nText zh="视频 · 总计" en="Videos · Total" />} value={stats.totals.videos} />
        <MetricCard label={<I18nText zh="信息源" en="Sources" />} value={stats.totals.sources} />
        <MetricCard label={<I18nText zh="主题数" en="Topics" />} value={stats.totals.topics} />
        <MetricCard label={<I18nText zh="待审核草稿" en="Pending drafts" />} value={stats.totals.draftNews} />
      </div>

      <div className="chart-grid" style={{ marginTop: 24 }}>
        <div className="chart-card">
          <h3><I18nText zh="文章每日数量" en="Posts per day" /></h3>
          <BarChart buckets={stats.newsBuckets} />
        </div>
        <div className="chart-card">
          <h3><I18nText zh="视频每日数量" en="Videos per day" /></h3>
          <LineChart buckets={stats.videoBuckets} />
        </div>
        <div className="chart-card">
          <h3><I18nText zh="文章 vs 视频 堆叠" en="Posts vs videos" /></h3>
          <StackedBarChart primary={stats.newsBuckets} secondary={stats.videoBuckets} />
        </div>
        <div className="chart-card">
          <h3><I18nText zh="分类占比" en="Topic share" /></h3>
          <DonutChart slices={stats.topicSlices} />
        </div>
        <div className="chart-card">
          <h3><I18nText zh="当天小时分布" en="Today by hour" /></h3>
          <BarChart buckets={stats.hourBuckets} color="var(--chart-3)" />
        </div>
      </div>

      <h2 style={{ marginTop: 40 }}><I18nText zh="访问统计" en="Traffic" /></h2>
      <p className="muted">
        <I18nText
          zh="页面浏览由前台埋点上报（JS 上报，天然过滤大部分爬虫）；独立访客为当日首访近似值。"
          en="Page views are reported by a lightweight client beacon (filters most bots). Unique visitors are a first-visit-of-day approximation."
        />
      </p>
      <div className="admin-grid-3">
        <MetricCard label={<I18nText zh="浏览量 · 今日" en="Views · Today" />} value={visits.todayPv} />
        <MetricCard label={<I18nText zh="独立访客 · 今日" en="Visitors · Today" />} value={visits.todayUv} />
        <MetricCard label={<I18nText zh="浏览量 · 近 7 天" en="Views · 7 days" />} value={visits.weekPv} />
        <MetricCard label={<I18nText zh="浏览量 · 近 30 天" en="Views · 30 days" />} value={visits.monthPv} />
      </div>
      <div className="chart-grid" style={{ marginTop: 24 }}>
        <div className="chart-card">
          <h3><I18nText zh="近 14 天浏览量" en="Views, last 14 days" /></h3>
          <BarChart buckets={visits.trend} color="var(--chart-2)" />
        </div>
        <div className="chart-card">
          <h3><I18nText zh="热门页面 · 近 30 天" en="Top pages · 30 days" /></h3>
          {visits.topPaths.length === 0 ? (
            <p className="muted"><I18nText zh="暂无数据" en="No data yet" /></p>
          ) : (
            <ol className="visit-top-list">
              {visits.topPaths.map((item) => (
                <li key={item.path}>
                  <span className="visit-top-path" title={item.path}>{item.title || item.path}</span>
                  <span className="visit-top-count">{item.count}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
