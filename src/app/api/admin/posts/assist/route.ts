import { NextResponse } from "next/server";
import { z } from "zod";
import { generateArticleRevision } from "@/lib/ai";
import { requireAdmin } from "@/lib/auth";
import { getModelConfigForUse } from "@/lib/model-selection";
import { parseJsonBody } from "@/lib/request-validation";

export const dynamic = "force-dynamic";

// 管理员编辑文章时的 AI 辅助调整。输入编辑框里的当前内容与指令，
// 返回修订稿；不写库——是否应用由管理员在编辑器里决定后照常保存。
const BodySchema = z.object({
  title: z.string().max(300).default(""),
  summary: z.string().max(4000).default(""),
  // generateArticleRevision sends the complete body. Refuse oversized input
  // instead of silently slicing off a tail that could contain references/media.
  content: z.string().max(40000, "AI 辅助单次最多处理 40000 个字符，请先分段调整").default(""),
  instruction: z.string().min(1).max(4000),
  scope: z.enum(["content", "full"]).default("content")
});

export async function POST(request: Request) {
  await requireAdmin();

  const parsed = await parseJsonBody(request, BodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (!body.content.trim() && !body.title.trim()) {
    return NextResponse.json({ error: "编辑器内容为空，没有可调整的文本" }, { status: 400 });
  }

  const modelConfig = await getModelConfigForUse("content");
  if (!modelConfig) {
    return NextResponse.json({ error: "尚未配置内容模型，请先在 设置 → 模型 中添加" }, { status: 503 });
  }

  try {
    const result = await generateArticleRevision({
      modelConfig,
      title: body.title,
      summary: body.summary,
      content: body.content,
      instruction: body.instruction,
      scope: body.scope
    });
    return NextResponse.json(result);
  } catch (error) {
    // 管理端可以回显真实报错（Key 失效 / 上游超时等），方便管理员排查。
    const message = error instanceof Error ? error.message : String(error);
    console.error("[post-assist] model call failed:", error);
    return NextResponse.json({ error: `模型调用失败：${message.slice(0, 300)}` }, { status: 502 });
  }
}
