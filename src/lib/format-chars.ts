/** 与 firefly 侧栏一致的字数缩写口径：≥1w 显示 X.Xw（万），≥1k 显示 X.Xk。 */
export function formatChars(total: number): string {
  if (total >= 10_000) return `${(total / 10_000).toFixed(1)}w`;
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}k`;
  return String(total);
}
