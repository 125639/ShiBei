import type IORedis from "ioredis";

const pending = new WeakMap<IORedis, Promise<void>>();

/** All cold-start callers await the same connection; no command runs before ready. */
export function waitForRedisReady(redis: IORedis, timeoutMs = 5_000): Promise<void> {
  if (redis.status === "ready") return Promise.resolve();
  const existing = pending.get(redis);
  if (existing) return existing;
  const connection = new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      redis.removeListener("ready", onReady);
      redis.removeListener("error", onError);
      redis.removeListener("end", onEnd);
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => finish();
    const onError = (error: Error) => finish(error);
    const onEnd = () => finish(new Error("Redis connection ended"));
    const timer = setTimeout(() => finish(new Error("Redis connection timed out")), timeoutMs);
    redis.once("ready", onReady);
    redis.once("error", onError);
    redis.once("end", onEnd);
    if (redis.status === "wait") void redis.connect().catch(onError);
    else if (redis.status === "end") onEnd();
  });
  pending.set(redis, connection);
  const cleanup = () => { if (pending.get(redis) === connection) pending.delete(redis); };
  void connection.then(cleanup, cleanup);
  return connection;
}
