export type SettledTaskStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";

export type BatchProgress = {
  settled: number;
  total: number;
  percent: number;
};

/**
 * 批次进度只计算已经到达终态的任务。运行中的任务耗时不可预测，不能为了
 * 让进度条“动起来”而虚构半格进度；失败也属于已结束，否则失败批次永远
 * 无法走到 100%。
 */
export function getBatchProgress(statuses: readonly SettledTaskStatus[]): BatchProgress {
  const total = statuses.length;
  const settled = statuses.reduce(
    (count, status) => count + (status === "COMPLETED" || status === "FAILED" ? 1 : 0),
    0
  );
  return {
    settled,
    total,
    percent: total === 0 ? 0 : Math.round((settled / total) * 100)
  };
}

export function clampProgress(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(Math.max(value, 0), max);
}
