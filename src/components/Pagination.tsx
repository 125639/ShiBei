import Link from "next/link";

type PaginationParams = Record<string, string | number | null | undefined>;

export function Pagination({
  basePath,
  page,
  totalPages,
  params = {}
}: {
  basePath: string;
  page: number;
  totalPages: number;
  params?: PaginationParams;
}) {
  if (totalPages <= 1) return null;
  const current = Math.min(Math.max(1, page), totalPages);

  return (
    <nav className="pagination-row" aria-label="Pagination">
      {current > 1 ? (
        <Link className="button secondary" href={buildHref(basePath, params, current - 1)}>上一页</Link>
      ) : (
        <span className="button secondary disabled" aria-disabled="true">上一页</span>
      )}
      <span className="pagination-status">第 {current} / {totalPages} 页</span>
      {current < totalPages ? (
        <Link className="button secondary" href={buildHref(basePath, params, current + 1)}>下一页</Link>
      ) : (
        <span className="button secondary disabled" aria-disabled="true">下一页</span>
      )}
    </nav>
  );
}

function buildHref(basePath: string, params: PaginationParams, page: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    query.set(key, String(value));
  }
  if (page > 1) query.set("page", String(page));
  const qs = query.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
