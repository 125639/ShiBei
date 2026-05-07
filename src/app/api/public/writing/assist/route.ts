import { NextResponse } from "next/server";
import { z } from "zod";
import { generateWritingAssist } from "@/lib/ai";
import { isLanguageKey } from "@/lib/language";
import { getModelConfigForUse } from "@/lib/model-selection";
import { isFrontend } from "@/lib/app-mode";
import { proxyToBackend } from "@/lib/sync/proxy";
import { ensureBackendCallerAllowed } from "@/lib/sync/backend-auth";

export const dynamic = "force-dynamic";

const CustomModelSchema = z.object({
  baseUrl: z.string().url(),
  model: z.string().min(1).max(200),
  apiKey: z.string().min(1).max(1000),
  temperature: z.number().min(0).max(2).optional().default(0.4),
  maxTokens: z.number().min(200).max(8000).optional().default(2200)
});

const BodySchema = z.object({
  title: z.string().max(300).optional().default(""),
  draft: z.string().max(50000).optional().default(""),
  instruction: z.string().max(4000).optional().default(""),
  language: z.string().optional().default("zh"),
  customModel: CustomModelSchema.nullable().optional()
});

export async function POST(request: Request) {
  // frontend 模式:无本地模型,转发到 backend。
  // 用户填写的 customModel Key 会跟着 body 一起转走 — 这是公开端点的固有行为。
  if (isFrontend()) {
    return proxyToBackend(request, "/api/public/writing/assist");
  }

  // backend 模式暴露在公网时，必须验证共享密钥，否则任何人都能消耗你的模型 Key。
  const denied = await ensureBackendCallerAllowed(request);
  if (denied) return denied;

  const body = BodySchema.parse(await request.json());
  const language = isLanguageKey(body.language) ? body.language : "zh";
  const draft = [body.title.trim() ? `# ${body.title.trim()}` : "", body.draft].filter(Boolean).join("\n\n");

  if (body.customModel) {
    const output = await generateWritingAssist({
      modelConfig: {
        baseUrl: body.customModel.baseUrl,
        model: body.customModel.model,
        temperature: body.customModel.temperature,
        maxTokens: body.customModel.maxTokens,
        apiKeyEnc: ""
      },
      apiKey: body.customModel.apiKey,
      draft,
      instruction: body.instruction,
      language
    });
    return NextResponse.json({ output, usingCustomModel: true });
  }

  const modelConfig = await getModelConfigForUse("writing");
  if (!modelConfig) {
    return NextResponse.json({ error: "管理员尚未配置用户写作模型，请填写自己的模型 Key 后再试。" }, { status: 503 });
  }

  const output = await generateWritingAssist({
    modelConfig,
    draft,
    instruction: body.instruction,
    language
  });
  return NextResponse.json({ output, usingCustomModel: false });
}
