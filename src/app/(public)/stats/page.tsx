import Link from "next/link";
import { BarChart, DonutChart, LineChart, StackedBarChart } from "@/components/Charts";
import { PublicShell } from "@/components/PublicShell";
import { loadStats, type StatsWindow } from "@/lib/stats";

export const dynamic = "force-dynamic";
export const revalidate = 60;

const VALID: StatsWindow[] = ["today", "week", "total"];

export default async function StatsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requested = typeof params.window === "string" ? params.window : "week";
  const window: StatsWindow = (VALID as string[]).includes(requested) ? (requested as StatsWindow) : "week";
  const stats = await loadStats(window);

  return (
    <PublicShell>
      <main className="container bento-page">
        <section className="page-intro bento-card bento-wide">
          <p className="eyebrow">Statistics</p>
          <h1 className="page-title">数据看板</h1>
          <p className="muted-block">
            实时统计 ShiBei 收录的新闻与视频。该数据每分钟刷新一次缓存。
          </p>
        </section>

        <div className="topic-tabs" role="tablist" aria-label="时间窗口">
          {([
            { key: "today", label: "当天" },
            { key: "week", label: "本周（7 天）" },
            { key: "total", label: "全部" }
          ] as const).map((tab) => (
            <Link
              key={tab.key}
              role="tab"
              aria-selected={window === tab.key}
              className={window === tab.key ? "active" : ""}
              href={`/stats?window=${tab.key}`}
            >
              {tab.label}
            </Link>
          ))}
        </div>

        <div className="bento-grid stats-metric-bento">
          <Metric label="新闻 · 当天" value={stats.todayNews} />
          <Metric label="新闻 · 本周" value={stats.weekNews} />
          <Metric label="新闻 · 总数" value={stats.totals.news} />
          <Metric label="视频 · 当天" value={stats.todayVideos} />
          <Metric label="视频 · 本周" value={stats.weekVideos} />
          <Metric label="视频 · 总数" value={stats.totals.videos} />
        </div>

        <div className="bento-grid chart-bento">
          <div className="chart-card bento-card bento-wide">
            <h3>新闻数量（按日，近 {stats.newsBuckets.length} 天）</h3>
            <BarChart buckets={stats.newsBuckets} ariaLabel="按日新闻柱状图" />
          </div>
          <div className="chart-card bento-card bento-wide">
            <h3>视频数量（按日，近 {stats.videoBuckets.length} 天）</h3>
            <LineChart buckets={stats.videoBuckets} ariaLabel="按日视频折线图" />
          </div>
          <div className="chart-card bento-card bento-wide">
            <h3>新闻 vs 视频（堆叠对比）</h3>
            <StackedBarChart
              primary={stats.newsBuckets}
              secondary={stats.videoBuckets}
              ariaLabel="新闻视频对比"
            />
          </div>
          <div className="chart-card bento-card">
            <h3>新闻分类占比（{labelOf(window)}）</h3>
            <DonutChart slices={stats.topicSlices} ariaLabel="新闻分类环形图" />
          </div>
          <div className="chart-card bento-card">
            <h3>当天 24 小时分布</h3>
            <BarChart
              buckets={stats.hourBuckets}
              showAllLabels={false}
              ariaLabel="今天每小时新闻分布"
              color="var(--chart-3)"
            />
          </div>
          <div className="chart-card bento-card">
            <h3>分类详情</h3>
            {stats.topicSlices.length === 0 ? (
              <p className="muted">暂无分类数据。先在管理后台添加 NewsTopic 与已发布文章。</p>
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
          生成于 {new Date(stats.generatedAt).toLocaleString("zh-CN")}
        </p>
      </main>
    </PublicShell>
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
