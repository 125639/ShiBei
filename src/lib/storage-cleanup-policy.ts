export const MANUAL_STORAGE_CLEANUP_CONFIRMATION = "archive-old-posts-and-delete-local-videos";

export type StorageCleanupTrigger = "scheduled" | "manual";

export function normalizeCleanupRetentionDays(value: number, fallback = 30) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), 3650);
}

/**
 * cleanupCustomEnabled is the opt-in for background cleanup. A deliberate
 * administrator action is allowed independently, but is protected by the
 * confirmation contract shared by the UI and API.
 */
export function shouldRunStorageCleanup(input: {
  trigger: StorageCleanupTrigger;
  cleanupCustomEnabled: boolean;
}) {
  return input.trigger === "manual" || input.cleanupCustomEnabled;
}

export function shouldArchiveOldPosts(input: {
  trigger: StorageCleanupTrigger;
  overQuota: boolean;
}) {
  return input.trigger === "manual" || input.overQuota;
}

/**
 * AdminAiBatch is explicitly an audit/progress record. Its FetchJobs must not
 * disappear independently from the batch. Failed/running/queued jobs are also
 * diagnostic state, so routine retention only removes old, standalone,
 * successfully completed jobs.
 */
export function completedStandaloneJobRetentionWhere(cutoff: Date) {
  return {
    status: "COMPLETED" as const,
    completedAt: { lt: cutoff },
    adminAiBatchId: null
  };
}

export function isManualStorageCleanupConfirmed(value: FormDataEntryValue | null) {
  return value === MANUAL_STORAGE_CLEANUP_CONFIRMATION;
}

export function manualStorageCleanupConfirmationMessage(retentionDays: number) {
  const days = normalizeCleanupRetentionDays(retentionDays);
  return `危险操作：这会归档 ${days} 天前的已发布文章（即使当前未超出空间上限），并永久删除这些旧归档文章对应的本地视频文件。确认立即执行吗？`;
}
