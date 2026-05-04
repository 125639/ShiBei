import { Queue } from "bullmq";
import IORedis from "ioredis";

export const fetchQueueName = "shibei-fetch";
export const researchQueueName = "shibei-research";
export const audienceQueueName = "shibei-audience";
export const scheduleQueueName = "shibei-schedule";

export function createRedisConnection() {
  return new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null
  });
}

export function getFetchQueue() {
  return new Queue(fetchQueueName, { connection: createRedisConnection() });
}

export function getResearchQueue() {
  return new Queue(researchQueueName, { connection: createRedisConnection() });
}

export function getAudienceQueue() {
  return new Queue(audienceQueueName, { connection: createRedisConnection() });
}

export function getScheduleQueue() {
  return new Queue(scheduleQueueName, { connection: createRedisConnection() });
}
