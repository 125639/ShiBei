// 公开页在导航期间的即时反馈：所有公开页都是 force-dynamic（等 DB 响应），
// 骨架屏让切换不再白屏。外壳由 layout.tsx 持久渲染，这里只画内容区。
export default function PublicLoading() {
  return (
    <main className="container bento-page route-loading" aria-busy="true" aria-live="polite">
      <section className="page-intro bento-card">
        <span className="skeleton skeleton-eyebrow" />
        <span className="skeleton skeleton-title" />
        <span className="skeleton skeleton-text" style={{ width: "72%" }} />
      </section>
      <div className="bento-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div className="bento-card" key={i}>
            <div>
              <span className="skeleton skeleton-text" style={{ width: "40%" }} />
              <span className="skeleton skeleton-heading" />
              <span className="skeleton skeleton-text" />
              <span className="skeleton skeleton-text" style={{ width: "85%" }} />
            </div>
            <span className="skeleton skeleton-text" style={{ width: "30%" }} />
          </div>
        ))}
      </div>
      <p className="sr-only">内容加载中 / Loading…</p>
    </main>
  );
}
