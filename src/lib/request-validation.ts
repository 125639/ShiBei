import { NextResponse } from "next/server";
import type { z } from "zod";

/**
 * 所有 JSON 接口的请求体硬上限。
 *
 * Next App Router 的 Route Handler 默认不限请求体大小（与 Server Action 的
 * 1MB 默认不同），`request.json()` 会把整个流缓冲进内存。公开接口
 * （/api/public/*、/api/member/*）无凭据即可调用，不设上限等于把进程内存
 * 交给调用方支配——1 核 1G 机型上 Next 堆只有 192MB。
 *
 * 2MB 的取值来自当前最大的合法载荷：写作台文档正文上限 200,000 字符
 * （lib/creation-limits.ts），全中文 UTF-8 约 600KB，加 JSON 转义余量仍
 * 远低于 2MB。需要更严的接口用 maxBytes 单独收紧。
 */
export const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;

/**
 * 按字节上限读取请求体文本；超限返回 null（调用方回 413）。
 *
 * 边读边计数而不是先 text() 再判断长度：后者在超限时内存已经吃满了，
 * 判断得再准也没用。TextDecoder 用 fatal 模式，非法 UTF-8 直接失败而不是
 * 静默替换成 U+FFFD 后进入业务逻辑。
 */
export async function readBoundedText(
  request: Request,
  maxBytes: number
): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

/** Content-Length 预检：声明就超限时连流都不用读。 */
export function declaredLengthExceeds(request: Request, maxBytes: number): boolean {
  const declared = Number(request.headers.get("content-length"));
  return Number.isFinite(declared) && declared > maxBytes;
}

export async function parseJsonBody<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
  options: { maxBytes?: number } = {}
): Promise<{ ok: true; data: z.output<TSchema> } | { ok: false; response: NextResponse }> {
  const maxBytes = options.maxBytes ?? MAX_JSON_BODY_BYTES;
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "请求必须使用 application/json" },
        { status: 415 }
      )
    };
  }

  if (declaredLengthExceeds(request, maxBytes)) {
    return { ok: false, response: tooLarge(maxBytes) };
  }

  // 不用 request.json()：它无视上限、整体缓冲。先按上限读文本再自行 JSON.parse。
  const raw = await readBoundedText(request, maxBytes);
  if (raw === null) {
    return { ok: false, response: tooLarge(maxBytes) };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "请求体不是有效的 JSON" }, { status: 400 })
    };
  }

  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    }));
    // 把首个字段错误拼进顶层 error，前端的 requestJson 只读 error 字段，
    // 这样用户能直接看到「topic: 请用一句话说明想写什么」而非笼统的「请求不合法」。
    const first = issues[0];
    const detail = first ? `${first.path ? `${first.path}: ` : ""}${first.message}` : "";
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: detail ? `请求参数有误（${detail}）` : "请求参数有误",
          issues
        },
        { status: 400 }
      )
    };
  }

  return { ok: true, data: parsed.data };
}

function tooLarge(maxBytes: number) {
  return NextResponse.json(
    { error: `请求体过大，上限 ${Math.round(maxBytes / 1024)}KB` },
    { status: 413, headers: { "cache-control": "no-store" } }
  );
}
