/**
 * 列表页 ?page= 参数的统一解析。
 * - 非数字 / 非正数一律回落到第 1 页；
 * - 夹一个宽松上限，防止 ?page=1e15 之类的值转成巨大的 OFFSET 打到数据库。
 *   页码超过实际总页数时由页面自身处理（显示空列表 + 分页组件会夹到最后一页）。
 */
export function normalizePage(value: string | undefined, maxPage = 100_000): number {
  const n = Number(value || 1);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), maxPage);
}
