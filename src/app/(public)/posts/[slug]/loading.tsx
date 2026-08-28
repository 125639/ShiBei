// 文章详情骨架屏：形状贴近真实文章（返回链 → 标题区 → 正文行），
// 比通用卡片骨架更不「跳」。
export default function PostLoading() {
  return (
    <main className="container-narrow article-detail-page route-loading" aria-busy="true" aria-live="polite">
      <span className="skeleton skeleton-text" style={{ width: 120 }} />
      <header style={{ marginTop: 24 }}>
        <span className="skeleton skeleton-eyebrow" />
        <span className="skeleton skeleton-title" style={{ width: "88%", height: 42 }} />
        <span className="skeleton skeleton-title" style={{ width: "55%", height: 42 }} />
        <span className="skeleton skeleton-text" style={{ width: "70%", marginTop: 18 }} />
        <span className="skeleton skeleton-text" style={{ width: "40%" }} />
      </header>
      <div style={{ marginTop: 40 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <span
            className="skeleton skeleton-text"
            key={i}
            style={{ width: `${[100, 97, 99, 92, 100, 96, 88, 60][i]}%` }}
          />
        ))}
      </div>
      <p className="sr-only">文章加载中 / Loading article…</p>
    </main>
  );
}
