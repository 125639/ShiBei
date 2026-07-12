import { createHash } from "node:crypto";

/**
 * 给同一个 FetchJob 的子产物分配稳定 RawItem 主键。
 *
 * BullMQ 可能在瞬时故障后重跑整个任务；稳定主键配合 Post.rawItemId 的唯一
 * 约束，可以让已经成功落库的文章被复用，而不是再次公开发布一份副本。
 */
export function artifactRawItemId(fetchJobId: string, slot: string) {
  const digest = createHash("sha256")
    .update(fetchJobId)
    .update("\0")
    .update(slot)
    .digest("hex")
    .slice(0, 32);
  return `job_${digest}`;
}
