import { Queue } from "bullmq";
import IORedis from "ioredis";

export const fetchQueueName = "shibei-fetch";
export const researchQueueName = "shibei-research";
export const audienceQueueName = "shibei-audience";
export const scheduleQueueName = "shibei-schedule";
export const videoDownloadQueueName = "shibei-video-download";

export function createRedisConnection() {
  const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null
  });
  redis.on("error", () => undefined);
  return redis;
}

type QueueRegistry = {
  connection?: IORedis;
};

const queueRegistry = globalThis as typeof globalThis & { shibeiQueues?: QueueRegistry };

function getSharedQueue(name: string, defaultJobOptions: typeof JOB_HYGIENE | typeof NETWORK_JOB_OPTIONS) {
  const registry = queueRegistry.shibeiQueues ||= {};
  registry.connection ||= createRedisConnection();
  // Callers intentionally close their short-lived Queue facade in finally.
  // BullMQ does not close an externally supplied IORedis connection, so sharing
  // only the socket removes the leak without returning a previously closed Queue.
  return new Queue(name, { connection: registry.connection, defaultJobOptions });
}

// 完成/失败的 job 只在 Redis 里保留有限条数（诊断走 DB 的 FetchJob 表，
// 不依赖 Redis 记录）；VPS 上 Redis 只有 192MB 且 noeviction，攒多了会写满。
const JOB_HYGIENE = {
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 500 }
} as const;

// 抓取/研究/受众任务以网络 IO 为主，瞬时故障（超时、连接重置、对端 5xx）
// 值得自动重试；永久性失败（来源本身是错误页）由 worker 抛
// UnrecoverableError 跳过重试。
const NETWORK_JOB_OPTIONS = {
  ...JOB_HYGIENE,
  attempts: 3,
  backoff: { type: "exponential", delay: 30_000 }
} as const;

export function getFetchQueue() {
  return getSharedQueue(fetchQueueName, NETWORK_JOB_OPTIONS);
}

export function getResearchQueue() {
  return getSharedQueue(researchQueueName, NETWORK_JOB_OPTIONS);
}

export function getAudienceQueue() {
  return getSharedQueue(audienceQueueName, NETWORK_JOB_OPTIONS);
}

// schedule 任务只是往队列里派生 job，重试可能重复派生；video 下载 15 分钟级
// 且 lib 内有自己的状态机——都保持单次尝试，只加 Redis 清理。
export function getScheduleQueue() {
  return getSharedQueue(scheduleQueueName, JOB_HYGIENE);
}

export function getVideoDownloadQueue() {
  return getSharedQueue(videoDownloadQueueName, JOB_HYGIENE);
}
