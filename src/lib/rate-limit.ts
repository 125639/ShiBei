import IORedis from "ioredis";
import { trustedClientIp } from "./client-ip";

type RateLimitInput = {
  namespace: string;
  request: Request;
  subject?: string;
  limit: number;
  windowSec: number;
  /**
   * 覆盖默认的「本机解析客户端 IP」身份。用于 backend 收到已鉴权前端代理
   * 转发的请求时，按代理带来的原始访客标识限流（见 sync/backend-auth.ts）。
   * 调用方必须先完成鉴权再传入，否则等于放任伪造身份绕过限流。
   */
  identityOverride?: string;
};

type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number };

type GlobalRateLimitInput = {
  namespace: string;
  limit: number;
  windowSec: number;
};

type SubjectRateLimitInput = GlobalRateLimitInput & { subject: string };

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();
const globalForRateLimit = globalThis as unknown as { shibeiRateLimitRedis?: IORedis };
const MAX_MEMORY_BUCKETS = 5000;
const PRUNE_INTERVAL_MS = 60_000;
let lastPruneAt = 0;

function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!globalForRateLimit.shibeiRateLimitRedis) {
    const redis = new IORedis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true
    });
    // Connection failures are handled by the memory fallback below. Registering
    // a listener keeps ioredis from reporting that expected failure as unhandled.
    redis.on("error", () => undefined);
    globalForRateLimit.shibeiRateLimitRedis = redis;
  }
  return globalForRateLimit.shibeiRateLimitRedis;
}

export async function checkRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  const identity = input.identityOverride
    ? sanitizeKeyPart(input.identityOverride)
    : clientIdentity(input.request);
  const subject = input.subject ? `${identity}:${sanitizeKeyPart(input.subject)}` : identity;
  const key = `shibei:rate:${input.namespace}:${subject}`;
  return incrementLimitKey(key, input.limit, input.windowSec);
}

export async function checkGlobalRateLimit(input: GlobalRateLimitInput): Promise<RateLimitResult> {
  const key = `shibei:rate:${input.namespace}:global`;
  return incrementLimitKey(key, input.limit, input.windowSec);
}

/** Account/resource scoped limit that cannot be bypassed by rotating IP headers. */
export async function checkSubjectRateLimit(input: SubjectRateLimitInput): Promise<RateLimitResult> {
  const key = `shibei:rate:${input.namespace}:subject:${sanitizeKeyPart(input.subject)}`;
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
  return sanitizeKeyPart(trustedClientIp(request));
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
