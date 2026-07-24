import { NextResponse } from "next/server";
import { z } from "zod";
import { generateWritingAssist } from "@/lib/ai";
import { isLanguageKey } from "@/lib/language";
import { getModelConfigForUse } from "@/lib/model-selection";
import { isFrontend } from "@/lib/app-mode";
import { proxyToBackend } from "@/lib/sync/proxy";
import { ensureBackendCallerAllowed, publicAiRateLimitIdentity } from "@/lib/sync/backend-auth";
import { parseJsonBody } from "@/lib/request-validation";
import { checkGlobalRateLimit, checkRateLimit } from "@/lib/rate-limit";

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
  // 代理前先做本地 per-IP 限流，防止单个访客占满全站在 backend 侧的共享额度。
  if (isFrontend()) {
    const limited = await checkRateLimit({ namespace: "writing", request, limit: 20, windowSec: 60 * 60 });
    if (!limited.ok) {
      return NextResponse.json(
        { error: "写作辅助请求过于频繁，请稍后再试" },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
      );
    }
    return proxyToBackend(request, "/api/public/writing/assist");
  }

  // backend 模式暴露在公网时，必须验证共享密钥，否则任何人都能消耗你的模型 Key。
  const denied = await ensureBackendCallerAllowed(request);
  if (denied) return denied;

  const limited = await checkRateLimit({
    namespace: "writing",
    request,
    limit: 20,
    windowSec: 60 * 60,
    // 已鉴权的前端代理调用按其转发的原始访客标识限流，而不是前端出口 IP。
    identityOverride: publicAiRateLimitIdentity(request)
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "写作辅助请求过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
  }
  const globalLimited = await checkGlobalRateLimit({
    namespace: "writing",
    limit: envInt("AI_WRITING_DAILY_LIMIT", 200),
    windowSec: 24 * 60 * 60
  });
  if (!globalLimited.ok) {
    return NextResponse.json(
      { error: "今日 AI 写作额度已用完，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(globalLimited.retryAfterSec) } }
    );
  }

  const parsed = await parseJsonBody(request, BodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const language = isLanguageKey(body.language) ? body.language : "zh";
  const draft = [body.title.trim() ? `# ${body.title.trim()}` : "", body.draft].filter(Boolean).join("\n\n");

  if (body.customModel) {
    try {
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
    } catch (error) {
      // 自定义模型是用户自己的配置，回显失败原因帮助排查（Key 错误 / 地址不通等）。
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ error: `自定义模型调用失败：${message.slice(0, 300)}` }, { status: 502 });
    }
  }

  const modelConfig = await getModelConfigForUse("writing");
  if (!modelConfig) {
    return NextResponse.json({ error: "管理员尚未配置用户写作模型，请填写自己的模型 Key 后再试。" }, { status: 503 });
  }

  try {
    const output = await generateWritingAssist({
      modelConfig,
      draft,
      instruction: body.instruction,
      language
    });
    return NextResponse.json({ output, usingCustomModel: false });
  } catch (error) {
    // 管理员模型的报错细节（含上游响应）只进日志，避免泄漏站点模型配置。
    console.error("[writing-assist] model call failed:", error);
    return NextResponse.json({ error: "AI 写作服务暂时不可用，请稍后再试" }, { status: 502 });
  }
}

function envInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
