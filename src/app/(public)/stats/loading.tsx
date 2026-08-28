// 数据看板骨架屏：KPI 三连 + 图表块，与真实布局同构，切换时不跳版。
export default function StatsLoading() {
  return (
    <main className="container bento-page route-loading" aria-busy="true" aria-live="polite">
      <section className="page-intro bento-card bento-wide">
        <span className="skeleton skeleton-eyebrow" />
        <span className="skeleton skeleton-title" style={{ width: 220 }} />
        <span className="skeleton skeleton-text" style={{ width: "60%" }} />
      </section>
      <div className="bento-grid stats-metric-bento">
        {Array.from({ length: 3 }).map((_, i) => (
          <div className="metric-card bento-card" key={i}>
            <span className="skeleton skeleton-heading" style={{ width: 80, height: 40 }} />
            <span className="skeleton skeleton-text" style={{ width: 110 }} />
          </div>
        ))}
      </div>
      <div className="bento-grid chart-bento">
        <div className="chart-card bento-card bento-wide">
          <span className="skeleton skeleton-heading" style={{ width: 240 }} />
          <span className="skeleton" style={{ height: 200, borderRadius: 10 }} />
        </div>
        <div className="chart-card bento-card">
          <span className="skeleton skeleton-heading" style={{ width: 180 }} />
          <span className="skeleton" style={{ height: 200, borderRadius: 10 }} />
        </div>
        <div className="chart-card bento-card">
          <span className="skeleton skeleton-heading" style={{ width: 160 }} />
          <span className="skeleton" style={{ height: 200, borderRadius: 10 }} />
        </div>
      </div>
      <p className="sr-only">统计数据加载中 / Loading stats…</p>
    </main>
  );
}
