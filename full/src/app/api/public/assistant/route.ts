import { NextResponse } from "next/server";
import { z } from "zod";
import { generateAssistantReply } from "@/lib/ai";
import { isLanguageKey } from "@/lib/language";
import { getModelConfigForUse } from "@/lib/model-selection";
import { isFrontend } from "@/lib/app-mode";
import { proxyToBackend } from "@/lib/sync/proxy";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  message: z.string().min(1).max(4000),
  context: z.string().max(30000).optional().default(""),
  language: z.string().optional().default("zh")
});

export async function POST(request: Request) {
  // frontend 模式下，AI 调用走代理到 backend，避免在前端持有 API Key。
  if (isFrontend()) {
    return proxyToBackend(request, "/api/public/assistant");
  }

  const body = BodySchema.parse(await request.json());
  const modelConfig = await getModelConfigForUse("assistant");
  if (!modelConfig) {
    return NextResponse.json({ error: "管理员尚未配置 AI 助手模型" }, { status: 503 });
  }

  const reply = await generateAssistantReply({
    modelConfig,
    userMessage: body.message,
    context: body.context,
    language: isLanguageKey(body.language) ? body.language : "zh"
  });

  return NextResponse.json({ reply });
}
