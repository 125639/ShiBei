import { waitForRedisReady } from "./redis-ready";
import crypto from "node:crypto";
import IORedis from "ioredis";

const memoryLocks = new Map<string, { token: string; expiresAt: number }>();
const globalForInFlight = globalThis as unknown as { shibeiInFlightRedis?: IORedis };

function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!globalForInFlight.shibeiInFlightRedis || globalForInFlight.shibeiInFlightRedis.status === "end") {
    const redis = new IORedis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true
    });
    // Consume handled connection errors; configured Redis failures must fail closed.
    redis.on("error", () => undefined);
    globalForInFlight.shibeiInFlightRedis = redis;
  }
  return globalForInFlight.shibeiInFlightRedis;
}

export async function withInFlightLock<T>(
  key: string,
  ttlSec: number,
  fn: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; reason: "busy" | "unavailable" }> {
  const token = crypto.randomBytes(16).toString("hex");
  const redisKey = `shibei:lock:${key}`;
  const redis = getRedis();

  if (redis) {
    // 只把「连接 + 加锁」放进 try，业务执行必须放在外面。
    // 此前 fn() 也在同一个 try 内，业务异常（模型报错、DB 报错）会被误判成
    // 「Redis 不可用」而落到下面的内存锁分支，于是 fn() 被**再执行一次**：
    // 对 translate / 讲解 / 识别这类付费调用就是重复计费。
    let acquired = false;
    let lockServiceFailed = false;
    try {
      await waitForRedisReady(redis);
      acquired = (await redis.set(redisKey, token, "EX", ttlSec, "NX")) === "OK";
    } catch {
      lockServiceFailed = true;
    }

    if (lockServiceFailed) {
      console.error("[in-flight] Redis unavailable; refusing paid work without a distributed lock");
      return { ok: false, reason: "unavailable" };
    }
    // 拿不到锁 = 确实有别的请求正在执行：返回 busy，绝不降级到内存锁，
    // 否则多实例会同时执行同一任务。
    if (!acquired) return { ok: false, reason: "busy" };
    try {
      return { ok: true, value: await fn() };
    } finally {
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        redisKey,
        token
      ).catch(() => undefined);
    }
  }

  const now = Date.now();
  const current = memoryLocks.get(key);
  if (current && current.expiresAt > now) return { ok: false, reason: "busy" };
  memoryLocks.set(key, { token, expiresAt: now + ttlSec * 1000 });
  try {
    return { ok: true, value: await fn() };
  } finally {
    const latest = memoryLocks.get(key);
    if (latest?.token === token) memoryLocks.delete(key);
  }
}
