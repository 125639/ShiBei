import { NextResponse } from "next/server";
import { z } from "zod";
import { generateAssistantReply } from "@/lib/ai";
import { isLanguageKey } from "@/lib/language";
import { getModelConfigForUse } from "@/lib/model-selection";
import { isFrontend } from "@/lib/app-mode";
import { proxyToBackend } from "@/lib/sync/proxy";
import { ensureBackendCallerAllowed } from "@/lib/sync/backend-auth";
import { parseJsonBody } from "@/lib/request-validation";
import { checkGlobalRateLimit, checkRateLimit } from "@/lib/rate-limit";

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

  // backend 模式暴露在公网时，必须验证共享密钥，否则任何人都能消耗你的模型 Key。
  const denied = await ensureBackendCallerAllowed(request);
  if (denied) return denied;

  const limited = await checkRateLimit({ namespace: "assistant", request, limit: 30, windowSec: 60 * 60 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
  }
  const globalLimited = await checkGlobalRateLimit({
    namespace: "assistant",
    limit: envInt("AI_ASSISTANT_DAILY_LIMIT", 300),
    windowSec: 24 * 60 * 60
  });
  if (!globalLimited.ok) {
    return NextResponse.json(
      { error: "今日 AI 助手额度已用完，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(globalLimited.retryAfterSec) } }
    );
  }

  const parsed = await parseJsonBody(request, BodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const modelConfig = await getModelConfigForUse("assistant");
  if (!modelConfig) {
    return NextResponse.json({ error: "管理员尚未配置 AI 助手模型" }, { status: 503 });
  }

  try {
    const reply = await generateAssistantReply({
      modelConfig,
      userMessage: body.message,
      context: body.context,
      language: isLanguageKey(body.language) ? body.language : "zh"
    });
    return NextResponse.json({ reply });
  } catch (error) {
    // 模型侧错误细节（可能含上游响应体）只进日志，不回给公网用户。
    console.error("[assistant] model call failed:", error);
    return NextResponse.json({ error: "AI 助手暂时不可用，请稍后再试" }, { status: 502 });
  }
}

function envInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
