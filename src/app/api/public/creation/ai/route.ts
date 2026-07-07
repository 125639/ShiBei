import { NextResponse } from "next/server";
import { z } from "zod";
import { requestChatCompletion } from "@/lib/ai";
import { getModelConfigForUse } from "@/lib/model-selection";
import { isBackend } from "@/lib/app-mode";
import { ensureBackendCallerAllowed } from "@/lib/sync/backend-auth";
import { parseJsonBody } from "@/lib/request-validation";
import { checkCreationAiBudget } from "@/lib/creation-server";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  prompt: z.string().min(1).max(120000),
  system: z.string().min(1).max(8000)
});

/**
 * 共创 AI 桥接端点：仅供 frontend 部署经 SYNC_TOKEN 调用。
 * full 模式下共创直接走本地模型，这个原始补全端点绝不能开放（等于公开的模型代理），
 * 所以非 backend 模式一律 404。
 */
export async function POST(request: Request) {
  if (!isBackend()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const denied = await ensureBackendCallerAllowed(request);
  if (denied) return denied;

  const budget = await checkCreationAiBudget(request, "creation-bridge", 120);
  if (budget) return budget;

  const parsed = await parseJsonBody(request, BodySchema);
  if (!parsed.ok) return parsed.response;

  const modelConfig = await getModelConfigForUse("writing");
  if (!modelConfig) {
    return NextResponse.json({ error: "管理员尚未配置写作模型" }, { status: 503 });
  }

  try {
    const output = await requestChatCompletion(modelConfig, parsed.data.prompt, parsed.data.system);
    return NextResponse.json({ output });
  } catch (error) {
    // 上游模型错误细节只进日志；frontend 调用方只需知道桥接暂不可用。
    console.error("[creation-bridge] model call failed:", error);
    return NextResponse.json({ error: "AI 服务暂时不可用，请稍后再试" }, { status: 502 });
  }
}
