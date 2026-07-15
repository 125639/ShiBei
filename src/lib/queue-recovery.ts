import type { Queue } from "bullmq";

export type FetchQueueKind = "fetch" | "research" | "audience";

type PendingFetchJob = {
  id: string;
  status: "QUEUED" | "RUNNING";
  sourceUrl: string;
  updatedAt: Date;
};

type PendingVideo = {
  id: string;
  downloadStatus: string | null;
  updatedAt: Date;
};

export type QueueRecoveryStore = {
  fetchJob: {
    findMany(args: unknown): Promise<PendingFetchJob[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  video: {
    findMany(args: unknown): Promise<PendingVideo[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

export type WorkerRecoveryQueues = {
  fetch: Queue;
  research: Queue;
  audience: Queue;
  video: Queue;
};

type RecoveryLogger = Pick<Console, "info" | "warn" | "error">;

export type WorkerQueueRecoverySummary = {
  fetchJobsInspected: number;
  fetchJobsRequeued: number;
  runningFetchJobsReset: number;
  videosInspected: number;
  videosRequeued: number;
  runningVideosReset: number;
};

const LIVE_JOB_STATES = ["active", "waiting", "delayed", "prioritized", "waiting-children"] as const;

/** Keep queue routing in one testable place so recovery mirrors producers. */
export function fetchQueueKindForSourceUrl(sourceUrl: string): FetchQueueKind {
  if (sourceUrl.startsWith("audience://estimate")) return "audience";
  if (/^(?:keyword:\/\/research|digest:\/\/topic|post-repair:\/\/publish)/.test(sourceUrl)) {
    return "research";
  }
  return "fetch";
}

export function recoveryJobId(fetchJobId: string) {
  // BullMQ custom IDs may not contain ':'. Prisma cuid IDs are already safe,
  // but normalize defensively for imported databases.
  return `db-recovery-${fetchJobId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

async function liveDataIds(queue: Queue, field: "fetchJobId" | "videoId") {
  const jobs = await queue.getJobs([...LIVE_JOB_STATES], 0, -1, true);
  const ids = new Set<string>();
  for (const job of jobs) {
    const value = (job.data as Record<string, unknown> | undefined)?.[field];
    if (typeof value === "string" && value) ids.add(value);
  }
  return ids;
}

async function removeTerminalRecoveryJob(queue: Queue, jobId: string) {
  const existing = await queue.getJob(jobId);
  if (!existing) return false;
  const state = await existing.getState();
  if (state !== "completed" && state !== "failed") return true;
  await existing.remove();
  return false;
}

async function addRecoveredFetchJob(queue: Queue, job: PendingFetchJob) {
  const jobId = recoveryJobId(job.id);
  if (await removeTerminalRecoveryJob(queue, jobId)) return false;
  const repair = job.sourceUrl.startsWith("post-repair://publish");
  await queue.add(repair ? "post-repair" : "fetch", { fetchJobId: job.id }, {
    jobId,
    ...(fetchQueueKindForSourceUrl(job.sourceUrl) === "research" ? { priority: 1 } : {}),
    ...(repair ? { attempts: 1 } : {})
  });
  return true;
}

async function addRecoveredVideo(queue: Queue, videoId: string) {
  const jobId = `video-download-${videoId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  if (await removeTerminalRecoveryJob(queue, jobId)) return false;
  await queue.add("video-download", { videoId }, {
    jobId,
    removeOnComplete: true,
    removeOnFail: true
  });
  return true;
}

/**
 * Reconcile durable DB state with BullMQ after worker/Redis restarts.
 *
 * A RUNNING row is only reset when its queue contains no live delivery. That
 * avoids interrupting a healthy processor in multi-worker deployments. Stable
 * recovery job IDs make concurrent reconcilers safe, while the worker's atomic
 * QUEUED -> RUNNING claim protects against an older producer job racing the
 * recovered one.
 */
export async function reconcileWorkerQueues(input: {
  store: QueueRecoveryStore;
  queues: WorkerRecoveryQueues;
  logger?: RecoveryLogger;
}): Promise<WorkerQueueRecoverySummary> {
  const logger = input.logger ?? console;
  const summary: WorkerQueueRecoverySummary = {
    fetchJobsInspected: 0,
    fetchJobsRequeued: 0,
    runningFetchJobsReset: 0,
    videosInspected: 0,
    videosRequeued: 0,
    runningVideosReset: 0
  };

  // Read queue state before changing DB rows. If Redis is unavailable this
  // throws and no durable status is modified; the next periodic pass retries.
  const [fetchLive, researchLive, audienceLive, videoLive] = await Promise.all([
    liveDataIds(input.queues.fetch, "fetchJobId"),
    liveDataIds(input.queues.research, "fetchJobId"),
    liveDataIds(input.queues.audience, "fetchJobId"),
    liveDataIds(input.queues.video, "videoId")
  ]);
  const liveByKind: Record<FetchQueueKind, Set<string>> = {
    fetch: fetchLive,
    research: researchLive,
    audience: audienceLive
  };

  const fetchJobs = await input.store.fetchJob.findMany({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, status: true, sourceUrl: true, updatedAt: true }
  });
  summary.fetchJobsInspected = fetchJobs.length;

  for (const job of fetchJobs) {
    const kind = fetchQueueKindForSourceUrl(job.sourceUrl);
    if (liveByKind[kind].has(job.id)) continue;

    if (job.status === "RUNNING") {
      const reset = await input.store.fetchJob.updateMany({
        where: { id: job.id, status: "RUNNING", updatedAt: job.updatedAt },
        data: {
          status: "QUEUED",
          completedAt: null,
          error: "worker/Redis 中断后未找到队列项，已自动恢复排队"
        }
      });
      if (reset.count !== 1) continue;
      summary.runningFetchJobsReset += 1;
    }

    try {
      if (await addRecoveredFetchJob(input.queues[kind], job)) {
        summary.fetchJobsRequeued += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await input.store.fetchJob.updateMany({
        where: { id: job.id, status: "QUEUED" },
        data: { error: `队列自动恢复暂时失败，将继续重试：${message.slice(0, 500)}` }
      }).catch(() => undefined);
      logger.warn(`[queue-recovery] failed to requeue FetchJob ${job.id}: ${message}`);
    }
  }

  const videos = await input.store.video.findMany({
    where: { downloadStatus: { in: ["queued", "running"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, downloadStatus: true, updatedAt: true }
  });
  summary.videosInspected = videos.length;

  for (const video of videos) {
    if (videoLive.has(video.id)) continue;
    if (video.downloadStatus === "running") {
      const reset = await input.store.video.updateMany({
        where: { id: video.id, downloadStatus: "running", updatedAt: video.updatedAt },
        data: {
          downloadStatus: "queued",
          downloadError: "worker/Redis 中断后未找到下载队列项，已自动恢复排队"
        }
      });
      if (reset.count !== 1) continue;
      summary.runningVideosReset += 1;
    }
    try {
      if (await addRecoveredVideo(input.queues.video, video.id)) summary.videosRequeued += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await input.store.video.updateMany({
        where: { id: video.id, downloadStatus: "queued" },
        data: { downloadError: `下载队列自动恢复暂时失败，将继续重试：${message.slice(0, 500)}` }
      }).catch(() => undefined);
      logger.warn(`[queue-recovery] failed to requeue Video ${video.id}: ${message}`);
    }
  }

  if (summary.fetchJobsRequeued || summary.videosRequeued) {
    logger.info(`[queue-recovery] reconciled ${JSON.stringify(summary)}`);
  }
  return summary;
}
