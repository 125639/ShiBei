/**
 * 后台表单里数值字段的统一解析。
 * Postgres int4 上限约 ±21 亿；这里夹在一个宽裕的展示范围内，
 * 防止 ?sortOrder=1e12 之类的输入直接把 DB 写入打挂。
 */
export function normalizeSortOrder(value: FormDataEntryValue | null): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1_000_000, Math.min(1_000_000, Math.floor(n)));
}

/** 知名度：非负整数，Int 字段夹到 int4 范围内，避免 NaN / 小数 / 超大数写库报错。 */
export function normalizePopularity(value: FormDataEntryValue | null): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 2_000_000_000);
}
