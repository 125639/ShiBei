import crypto from "node:crypto";
import IORedis from "ioredis";

const memoryLocks = new Map<string, { token: string; expiresAt: number }>();
const globalForInFlight = globalThis as unknown as { shibeiInFlightRedis?: IORedis };

function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!globalForInFlight.shibeiInFlightRedis) {
    globalForInFlight.shibeiInFlightRedis = new IORedis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true
    });
  }
  return globalForInFlight.shibeiInFlightRedis;
}

export async function withInFlightLock<T>(
  key: string,
  ttlSec: number,
  fn: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; reason: "busy" }> {
  const token = crypto.randomBytes(16).toString("hex");
  const redisKey = `shibei:lock:${key}`;
  const redis = getRedis();

  if (redis) {
    try {
      if (redis.status === "wait") await redis.connect();
      const acquired = await redis.set(redisKey, token, "EX", ttlSec, "NX");
      if (acquired !== "OK") return { ok: false, reason: "busy" };
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
    } catch {
      // Fall through to an in-process lock if Redis is temporarily unavailable.
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
