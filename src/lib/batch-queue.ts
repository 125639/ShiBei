export type BatchQueueItem<T> = {
  jobId: string;
  task: T;
};

export type BatchQueueOutcome<T> = BatchQueueItem<T> & {
  status: "QUEUED" | "FAILED";
  error: string | null;
};

type BatchQueueDependencies = {
  enqueue: (jobId: string) => Promise<void>;
  markFailed: (jobId: string, error: string) => Promise<void>;
};

/**
 * 逐项派发一个已经完整落库的批次。
 *
 * 队列是外部系统，批量派发中途可能短暂失败。单项失败必须被写成明确的
 * FAILED，同时继续派发后续项；否则第 N 项的一次 Redis 抖动会把 N+1…末项
 * 全部截掉，后台只会留下一个不完整批次。
 */
export async function enqueueBatchContinuing<T>(
  items: readonly BatchQueueItem<T>[],
  dependencies: BatchQueueDependencies
): Promise<Array<BatchQueueOutcome<T>>> {
  const outcomes: Array<BatchQueueOutcome<T>> = [];

  for (const item of items) {
    try {
      await dependencies.enqueue(item.jobId);
      outcomes.push({ ...item, status: "QUEUED", error: null });
    } catch (error) {
      const message = queueFailureMessage(error);
      // 状态落库失败属于数据库级故障，不能伪装成已正确记录后继续返回成功。
      // enqueue 的单项异常则已被隔离，后续任务仍会继续派发。
      await dependencies.markFailed(item.jobId, message);
      outcomes.push({ ...item, status: "FAILED", error: message });
    }
  }

  return outcomes;
}

export function queueFailureMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return `任务入队失败：${detail || "未知队列错误"}`.slice(0, 1000);
}
