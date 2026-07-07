import Link from "next/link";
import { I18nText } from "@/components/I18nText";

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
  const prevLabel = <I18nText zh="上一页" en="Previous" />;
  const nextLabel = <I18nText zh="下一页" en="Next" />;

  return (
    <nav className="pagination-row" aria-label="分页 Pagination">
      {current > 1 ? (
        <Link className="button secondary" rel="prev" href={buildHref(basePath, params, current - 1)}>{prevLabel}</Link>
      ) : (
        <span className="button secondary disabled" aria-disabled="true" aria-hidden="true">{prevLabel}</span>
      )}
      <span className="pagination-status" aria-current="page">
        <I18nText zh={`第 ${current} / ${totalPages} 页`} en={`Page ${current} of ${totalPages}`} />
      </span>
      {current < totalPages ? (
        <Link className="button secondary" rel="next" href={buildHref(basePath, params, current + 1)}>{nextLabel}</Link>
      ) : (
        <span className="button secondary disabled" aria-disabled="true" aria-hidden="true">{nextLabel}</span>
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
