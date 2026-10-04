import { LocalizedLink as Link } from "@/components/LocalizedLink";
import { Icon, type IconName } from "@/components/public/Icons";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BarChart, DonutChart, LineChart, StackedBarChart } from "@/components/Charts";
import { I18nText } from "@/components/I18nText";
import { getCachedVideosEnabled } from "@/lib/site-settings-cache";
import { loadCachedStats, type StatsWindow } from "@/lib/stats";
import { getCachedPublicVisitStats } from "@/lib/site-stats";
import { getCachedFireflyWidgetData } from "@/lib/firefly-widgets";



// Query parameters are request-specific. Keep the explicit data caches below,
// but do not generate an ISR HTML entry for this page on its first request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "数据看板",
  description: "站点收录、访问量与趋势的实时统计。",
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
  // firefly 小组件数据（总文章/字数/分类/运行天数）与访问聚合都已各自走缓存；
  // 埋点表异常时 visits 为 null，页内隐藏访问卡，不影响内容统计展示。
  const [stats, showVideos, widgets, visits] = await Promise.all([
    loadCachedStats(window),
    getCachedVideosEnabled(),
    getCachedFireflyWidgetData().catch(() => null),
    getCachedPublicVisitStats()
  ]);
  const siteStats = widgets?.stats ?? null;

  return (
    <main className="container bento-page public-list-page stats-page">
      <section className="page-intro bento-card bento-wide">
        <p className="eyebrow">Statistics</p>
        <h1 className="page-title"><I18nText zh="数据看板" en="Statistics" /></h1>
        <p className="muted-block">
          <I18nText
            zh="站点总览、访问趋势与内容统计，每分钟刷新一次缓存。"
            en="Site overview, visit trends, and content stats, cached for one minute."
          />
        </p>
      </section>

      {/* 站点总览：大数字卡（KPanel 概览式） */}
      <section aria-labelledby="stats-overview-title">
        <h2 className="stats-section-title" id="stats-overview-title">
          <I18nText zh="站点总览" en="Site overview" />
        </h2>
        <div className="bento-grid stats-metric-bento">
          <SiteMetric
            icon="list"
            label={<I18nText zh="已发布文章" en="Published posts" />}
            value={siteStats ? String(siteStats.posts) : "—"}
          />
          <SiteMetric
            icon="spark"
            label={<I18nText zh="累计字数" en="Characters" />}
            value={siteStats ? formatChars(siteStats.totalChars) : "—"}
          />
          <SiteMetric
            icon="grid"
            label={<I18nText zh="有内容分类" en="Topics with content" />}
            value={widgets ? String(widgets.categories.length) : "—"}
          />
          {siteStats && siteStats.runDays > 0 ? (
            <SiteMetric
              icon="clock"
              label={<I18nText zh="运行天数" en="Days running" />}
              value={String(siteStats.runDays)}
            />
          ) : null}
          {visits ? (
            <SiteMetric
              icon="rss"
              label={<I18nText zh="今日访问" en="Visits today" />}
              value={String(visits.todayPv)}
              sub={<I18nText zh={`${visits.todayUv} 位访客`} en={`${visits.todayUv} visitors`} />}
            />
          ) : null}
          {visits ? (
            <SiteMetric
              icon="up"
              label={<I18nText zh="近 30 天访问" en="Visits (30d)" />}
              value={String(visits.monthPv)}
              sub={<I18nText zh={`近 7 天 +${visits.weekPv}`} en={`+${visits.weekPv} this week`} />}
            />
          ) : null}
        </div>
      </section>

      {/* 访问趋势（近 14 天 PV）与最受欢迎文章（近 30 天）并排 */}
      {visits ? (
        <div className="bento-grid chart-bento">
          <div className="chart-card bento-card bento-wide">
            <h3><I18nText zh="访问趋势（按日，近 14 天）" en="Visits per day (last 14 days)" /></h3>
            <BarChart buckets={visits.trend} ariaLabel="近 14 天访问趋势柱状图" />
          </div>
          {visits.topPosts.length ? (
            <div className="chart-card bento-card bento-wide">
              <h3><I18nText zh="最受欢迎（近 30 天）" en="Most read (30d)" /></h3>
              <ol className="top-posts-list">
                {visits.topPosts.map((row, index) => (
                  <li key={row.path}>
                    <span className="top-posts-rank" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <Link className="top-posts-link" href={row.path}>
                      <I18nText zh={row.title} en={row.title} />
                    </Link>
                    <span className="top-posts-count">{row.count}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 内容统计：按窗口切换 */}
      <h2 className="stats-section-title">
        <I18nText zh="内容统计" en="Content stats" />
      </h2>
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
        <SiteMetric
          icon="list"
          label={<I18nText zh="文章 · 当天" en="Posts · Today" />}
          value={String(stats.todayNews)}
        />
        <SiteMetric
          icon="list"
          label={<I18nText zh="文章 · 本周" en="Posts · Week" />}
          value={String(stats.weekNews)}
        />
        <SiteMetric
          icon="list"
          label={<I18nText zh="文章 · 总数" en="Posts · Total" />}
          value={String(stats.totals.news)}
        />
        {showVideos ? (
          <>
            <SiteMetric
              icon="play"
              label={<I18nText zh="视频 · 当天" en="Videos · Today" />}
              value={String(stats.todayVideos)}
            />
            <SiteMetric
              icon="play"
              label={<I18nText zh="视频 · 本周" en="Videos · Week" />}
              value={String(stats.weekVideos)}
            />
            <SiteMetric
              icon="play"
              label={<I18nText zh="视频 · 总数" en="Videos · Total" />}
              value={String(stats.totals.videos)}
            />
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

/**
 * KPanel 式统计卡：图标 + 大数字 + 小标签。value 传字符串以容纳
 * 「54 / 54」「8.2w」这类复合值；sub 是可选的第二行补充（如访客数）。
 */
function SiteMetric({
  icon,
  label,
  value,
  sub
}: {
  icon: IconName;
  label: ReactNode;
  value: string;
  sub?: ReactNode;
}) {
  return (
    <div className="metric-card bento-card stats-site-metric">
      <span className="metric-icon" aria-hidden="true">
        <Icon name={icon} width="16" height="16" />
      </span>
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
      {sub ? <div className="metric-sub muted">{sub}</div> : null}
    </div>
  );
}

/** 与 firefly 侧栏一致的字数缩写口径（w = 万）。 */
function formatChars(total: number): string {
  if (total >= 10_000) return `${(total / 10_000).toFixed(1)}w`;
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}k`;
  return String(total);
}

/**
 * 分类详情：名称 + 计数 + 占比条。
 * `_other` 是「其余分类合并」的内部聚合 id，不是真实 slug，不对外展示；
 * 真实分类的 slug 也只是内部路由标识，列表里同样省去，版式更干净。
 */
function TopicBreakdown({ slices }: { slices: { id: string; name: string; slug: string; count: number }[] }) {
  // 显示级过滤：0 篇的分类不进榜单（与总览「有内容分类」口径对齐）；
  // 占比基数仍按窗口全量计算，0 篇分类不影响分母。
  const visible = slices.filter((s) => s.count > 0);
  const total = slices.reduce((acc, s) => acc + s.count, 0);
  const max = Math.max(...slices.map((s) => s.count), 1);

  if (!visible.length) {
    return (
      <p className="muted">
        <I18nText zh="该时间窗口内暂无分类数据。" en="No topic data in this window yet." />
      </p>
    );
  }

  return (
    <ul className="topic-breakdown">
      {visible.map((s) => {
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
