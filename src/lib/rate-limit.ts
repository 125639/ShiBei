import IORedis from "ioredis";

type RateLimitInput = {
  namespace: string;
  request: Request;
  subject?: string;
  limit: number;
  windowSec: number;
};

type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number };

type GlobalRateLimitInput = {
  namespace: string;
  limit: number;
  windowSec: number;
};

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();
const globalForRateLimit = globalThis as unknown as { shibeiRateLimitRedis?: IORedis };
const MAX_MEMORY_BUCKETS = 5000;
const PRUNE_INTERVAL_MS = 60_000;
let lastPruneAt = 0;

function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!globalForRateLimit.shibeiRateLimitRedis) {
    globalForRateLimit.shibeiRateLimitRedis = new IORedis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true
    });
  }
  return globalForRateLimit.shibeiRateLimitRedis;
}

export async function checkRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  const identity = clientIdentity(input.request);
  const subject = input.subject ? `${identity}:${sanitizeKeyPart(input.subject)}` : identity;
  const key = `shibei:rate:${input.namespace}:${subject}`;
  return incrementLimitKey(key, input.limit, input.windowSec);
}

export async function checkGlobalRateLimit(input: GlobalRateLimitInput): Promise<RateLimitResult> {
  const key = `shibei:rate:${input.namespace}:global`;
  return incrementLimitKey(key, input.limit, input.windowSec);
}

async function incrementLimitKey(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const redis = getRedis();

  if (redis) {
    try {
      if (redis.status === "wait") await redis.connect();
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSec);
      if (count <= limit) return { ok: true };
      const ttl = await redis.ttl(key);
      return { ok: false, retryAfterSec: ttl > 0 ? ttl : windowSec };
    } catch {
      // Fall through to memory buckets when Redis is unavailable.
    }
  }

  const now = Date.now();
  pruneMemoryBuckets(now);
  const resetAt = now + windowSec * 1000;
  const bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    memoryBuckets.set(key, { count: 1, resetAt });
    return { ok: true };
  }
  bucket.count += 1;
  if (bucket.count <= limit) return { ok: true };
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
}

function clientIdentity(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const raw = forwarded || realIp || "unknown";
  return sanitizeKeyPart(raw);
}

function sanitizeKeyPart(raw: string) {
  return raw.replace(/[^a-zA-Z0-9:._-]/g, "_").slice(0, 80);
}

function pruneMemoryBuckets(now: number) {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS && memoryBuckets.size <= MAX_MEMORY_BUCKETS) return;
  lastPruneAt = now;

  for (const [key, bucket] of memoryBuckets.entries()) {
    if (bucket.resetAt <= now) memoryBuckets.delete(key);
  }

  if (memoryBuckets.size <= MAX_MEMORY_BUCKETS) return;
  const overflow = memoryBuckets.size - MAX_MEMORY_BUCKETS;
  const oldestKeys = [...memoryBuckets.entries()]
    .sort((a, b) => a[1].resetAt - b[1].resetAt)
    .slice(0, overflow)
    .map(([key]) => key);
  for (const key of oldestKeys) memoryBuckets.delete(key);
}
