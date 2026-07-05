import { AdminShell } from "@/components/AdminShell";
import { BarChart, DonutChart, LineChart, StackedBarChart } from "@/components/Charts";
import { I18nText } from "@/components/I18nText";
import { MetricCard } from "@/components/MetricCard";
import { requireAdmin } from "@/lib/auth";
import { loadStats } from "@/lib/stats";

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
  const stats = await loadStats(window as "today" | "week" | "total");

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
    </AdminShell>
  );
}
