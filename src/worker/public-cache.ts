import {
  getInternalRevalidationSecret,
  INTERNAL_REVALIDATION_PATH,
  INTERNAL_REVALIDATION_SIGNATURE_HEADER,
  INTERNAL_REVALIDATION_TIMESTAMP_HEADER,
  normalizePublicRevalidationPaths,
  signInternalRevalidationRequest
} from "../lib/internal-revalidation";

export type PublicCacheNotificationResult =
  | { ok: true }
  | { ok: false; error: string; status?: number };

type NotificationOptions = {
  attempts?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "warn">;
  now?: () => number;
  secret?: string;
  timeoutMs?: number;
};

/**
 * Ask the Next process to invalidate its in-process public caches.
 *
 * This helper deliberately absorbs and logs transport failures: publication is
 * already committed by the time it is called and must never be rolled back just
 * because the cache notification could not be delivered.
 */
export async function notifyPublicContentRevalidation(
  requestedPaths: Array<string | null | undefined> = [],
  options: NotificationOptions = {}
): Promise<PublicCacheNotificationResult> {
  const logger = options.logger || console;
  try {
    const paths = normalizePublicRevalidationPaths(
      requestedPaths.filter((path): path is string => typeof path === "string")
    );
    const body = JSON.stringify({ paths });
    const secret = options.secret || getInternalRevalidationSecret();
    const baseUrl = (options.baseUrl || process.env.SHIBEI_INTERNAL_APP_URL || "").trim();
    if (!baseUrl) throw new Error("SHIBEI_INTERNAL_APP_URL 未配置");

    const endpoint = new URL(INTERNAL_REVALIDATION_PATH, ensureTrailingSlash(baseUrl));
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
      throw new Error("SHIBEI_INTERNAL_APP_URL 必须使用 http 或 https");
    }
    if (endpoint.username || endpoint.password) {
      throw new Error("SHIBEI_INTERNAL_APP_URL 不得包含用户名或密码");
    }

    const configuredAttempts = options.attempts ?? 3;
    const attempts = Number.isFinite(configuredAttempts)
      ? Math.max(1, Math.min(3, Math.trunc(configuredAttempts)))
      : 3;
    let lastError = "缓存刷新通知未完成";
    let lastStatus: number | undefined;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const timestamp = String((options.now || Date.now)());
      const signature = signInternalRevalidationRequest({ body, timestamp, secret });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
      try {
        const response = await (options.fetchImpl || fetch)(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [INTERNAL_REVALIDATION_TIMESTAMP_HEADER]: timestamp,
            [INTERNAL_REVALIDATION_SIGNATURE_HEADER]: signature
          },
          body,
          cache: "no-store",
          redirect: "error",
          signal: controller.signal
        });
        if (response.ok) return { ok: true };
        lastStatus = response.status;
        lastError = `Next 应用拒绝缓存刷新通知（HTTP ${response.status}）`;
        // Authentication and input errors are deterministic. Retrying them only
        // delays the worker and cannot repair a bad deployment configuration.
        if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) {
          break;
        }
      } catch (cause) {
        lastStatus = undefined;
        lastError = cause instanceof Error ? cause.message : String(cause);
      } finally {
        clearTimeout(timeout);
      }
      if (attempt < attempts) await retryDelay(attempt);
    }
    logger.warn(`[public-cache] 缓存刷新通知失败；已发布内容不会回滚：${lastError}`);
    return { ok: false, error: lastError, ...(lastStatus ? { status: lastStatus } : {}) };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    logger.warn(`[public-cache] 缓存刷新通知失败；已发布内容不会回滚：${error}`);
    return { ok: false, error };
  }
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function retryDelay(attempt: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, attempt * 250));
}
