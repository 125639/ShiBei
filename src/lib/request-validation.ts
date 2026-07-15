import { NextResponse } from "next/server";
import type { z } from "zod";

export async function parseJsonBody<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema
): Promise<{ ok: true; data: z.output<TSchema> } | { ok: false; response: NextResponse }> {
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

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "请求体不是有效的 JSON" }, { status: 400 })
    };
  }

  const parsed = schema.safeParse(raw);
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
