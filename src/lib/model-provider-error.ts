export const MODEL_COMPLETION_RESPONSE_LIMIT = 128 * 1024;
export const MODEL_LIST_RESPONSE_LIMIT = 2 * 1024 * 1024;

const SAFE_PROVIDER_DETAIL_LIMIT = 240;

/**
 * Read an upstream model response without allowing an untrusted provider to
 * make the application buffer an unbounded body. Model catalogues can be much
 * larger than a completion probe, so callers deliberately choose the limit.
 */
export async function readLimitedModelResponse(
  response: Response,
  limit = MODEL_COMPLETION_RESPONSE_LIMIT
): Promise<string> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("供应商响应过大，已停止读取。");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new Error("供应商响应过大，已停止读取。");
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

/**
 * Turn a provider-controlled string into a bounded diagnostic. Credentials
 * are removed both by exact value and by common Authorization/API-key forms.
 */
export function sanitizeModelProviderText(value: unknown, secrets: string[] = []): string {
  let cleaned = typeof value === "string" ? value : "";

  for (const secret of secrets
    .map((item) => item.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)) {
    cleaned = cleaned.split(secret).join("[已隐藏]");
  }

  cleaned = cleaned
    .replace(/\bBearer\s+[^\s,;"'<>]+/gi, "Bearer [已隐藏]")
    .replace(/\bsk-[A-Za-z0-9][A-Za-z0-9._~+/=-]{2,}/gi, "[已隐藏]")
    .replace(
      /\b(?:api[_ -]?key|access[_ -]?token|authorization)\s*[:=]\s*(?:Bearer\s+)?[^\s,;"'<>]+/gi,
      (match) => `${match.split(/[:=]/, 1)[0]}=[已隐藏]`
    )
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.slice(0, SAFE_PROVIDER_DETAIL_LIMIT);
}

/**
 * Extract only documented error-message fields from JSON. HTML, proxy pages,
 * debug dumps, and every other raw body are intentionally never reflected.
 */
export function safeModelProviderHttpError(
  status: number,
  body: string,
  secrets: string[] = []
): string {
  let detail: unknown = "";
  try {
    const payload = JSON.parse(body) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    detail = typeof payload.error === "string"
      ? payload.error
      : payload.error && typeof payload.error === "object"
        ? payload.error.message
        : payload.message;
  } catch {
    // Raw HTML/text/proxy bodies are never reflected into logs, jobs, or UI.
  }

  const safeDetail = sanitizeModelProviderText(detail, secrets);
  return `供应商返回 HTTP ${status}${safeDetail ? `：${safeDetail}` : ""}`;
}
