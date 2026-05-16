import { AdminShell } from "@/components/AdminShell";
import { BarChart, DonutChart, LineChart, StackedBarChart } from "@/components/Charts";
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
      <h1>数据看板</h1>

      <div className="topic-tabs">
        {(["today", "week", "total"] as const).map((tab) => (
          <a
            key={tab}
            className={window === tab ? "active" : ""}
            href={`/admin/stats?window=${tab}`}
          >
            {tab === "today" ? "当天" : tab === "week" ? "本周" : "全部"}
          </a>
        ))}
      </div>

      <div className="admin-grid-3">
        <Metric label="文章 · 当天" value={stats.todayNews} />
        <Metric label="文章 · 本周" value={stats.weekNews} />
        <Metric label="文章 · 总计" value={stats.totals.news} />
        <Metric label="视频 · 当天" value={stats.todayVideos} />
        <Metric label="视频 · 本周" value={stats.weekVideos} />
        <Metric label="视频 · 总计" value={stats.totals.videos} />
        <Metric label="信息源" value={stats.totals.sources} />
        <Metric label="主题数" value={stats.totals.topics} />
        <Metric label="待审核草稿" value={stats.totals.draftNews} />
      </div>

      <div className="chart-grid" style={{ marginTop: 18 }}>
        <div className="chart-card">
          <h3>文章每日数量</h3>
          <BarChart buckets={stats.newsBuckets} />
        </div>
        <div className="chart-card">
          <h3>视频每日数量</h3>
          <LineChart buckets={stats.videoBuckets} />
        </div>
        <div className="chart-card">
          <h3>文章 vs 视频 堆叠</h3>
          <StackedBarChart primary={stats.newsBuckets} secondary={stats.videoBuckets} />
        </div>
        <div className="chart-card">
          <h3>分类占比</h3>
          <DonutChart slices={stats.topicSlices} />
        </div>
        <div className="chart-card">
          <h3>当天小时分布</h3>
          <BarChart buckets={stats.hourBuckets} color="var(--chart-3)" />
        </div>
      </div>
    </AdminShell>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-card">
      <div style={{ fontSize: 28, fontWeight: 500, fontFamily: "var(--font-display)" }}>{value}</div>
      <div className="muted" style={{ fontSize: 13 }}>
        {label}
      </div>
    </div>
  );
}
