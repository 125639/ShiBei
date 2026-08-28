import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import {
  MODEL_CONFIG_LIMITS,
  ModelConfigValidationError,
  canReuseSavedModelKey,
  modelApiUrl,
  normalizeModelBaseUrl
} from "@/lib/model-config-input";
import { prisma } from "@/lib/prisma";
import { parseJsonBody } from "@/lib/request-validation";
import { providerThinkingOptions } from "@/lib/model-providers";
import {
  MODEL_COMPLETION_RESPONSE_LIMIT,
  MODEL_LIST_RESPONSE_LIMIT,
  readLimitedModelResponse,
  safeModelProviderHttpError
} from "@/lib/model-provider-error";
import { assertSafeResolvedFetchUrl, safeFetch } from "@/lib/url-safety";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  action: z.enum(["check", "models"]),
  configId: z.string().max(100).optional(),
  baseUrl: z.string().min(1).max(MODEL_CONFIG_LIMITS.baseUrl),
  model: z.string().max(MODEL_CONFIG_LIMITS.model).optional().default(""),
  apiKey: z.string().max(MODEL_CONFIG_LIMITS.apiKey).optional().default("")
});

export async function POST(request: Request) {
  await requireAdmin();
  const parsed = await parseJsonBody(request, BodySchema);
  if (!parsed.ok) return parsed.response;

  try {
    const baseUrl = normalizeModelBaseUrl(parsed.data.baseUrl);
    const model = parsed.data.model.trim();
    if (parsed.data.action === "check" && (!model || /\s/.test(model))) {
      return jsonError("请先填写有效的模型 ID。", 400);
    }

    let apiKey = parsed.data.apiKey.trim();
    if (!apiKey && parsed.data.configId) {
      const saved = await prisma.modelConfig.findUnique({
        where: { id: parsed.data.configId },
        select: { apiKeyEnc: true, baseUrl: true }
      });
      if (!saved) return jsonError("找不到这个模型配置，请刷新页面后重试。", 404);
      if (!canReuseSavedModelKey(saved.baseUrl, baseUrl)) {
        return jsonError("Base URL 已改变。为防止把旧供应商的 Key 发往新地址，请先填写新 API Key。", 400);
      }
      try {
        apiKey = decryptSecret(saved.apiKeyEnc);
      } catch {
        return jsonError("已保存的 API Key 无法解密，请重新填写 Key 后再检查。", 400);
      }
    }
    if (!apiKey || apiKey.length > MODEL_CONFIG_LIMITS.apiKey || /[\u0000-\u001f\u007f]/.test(apiKey)) {
      return jsonError("请填写有效的 API Key。", 400);
    }

    if (parsed.data.action === "models") {
      const models = await fetchModels(baseUrl, apiKey);
      return NextResponse.json(
        {
          ok: true,
          models,
          message: models.length
            ? `连接成功，获取到 ${models.length} 个模型。`
            : "连接成功，但供应商没有返回可用模型；仍可手动填写模型 ID。"
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const probe = await checkCompletion(baseUrl, model, apiKey);
    return NextResponse.json(
      {
        ok: true,
        message: probe.hasContent
          ? `轻量连通验证成功：模型 ${model} 返回了正文（finish_reason=${probe.finishReason}）。`
          : `接口、Key 与模型 ID 已被供应商识别；该推理模型在轻量预算内尚未输出正文（finish_reason=${probe.finishReason}），请以正式内容基准为准。`
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = safeProbeError(error);
    return jsonError(message, 502);
  }
}

async function fetchModels(baseUrl: string, apiKey: string) {
  const endpoint = await assertSafeResolvedFetchUrl(modelApiUrl(baseUrl, "models"));
  const response = await fetchWithTimeout(endpoint.toString(), {
    method: "GET",
    redirect: "error",
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }
  });
  const text = await readLimitedModelResponse(response, MODEL_LIST_RESPONSE_LIMIT);
  if (!response.ok) throw new Error(safeModelProviderHttpError(response.status, text, [apiKey]));

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("供应商的 /models 接口没有返回有效 JSON。可改为手动填写模型 ID。 ");
  }
  const rows = payload && typeof payload === "object" && "data" in payload
    ? (payload as { data?: unknown }).data
    : undefined;
  if (!Array.isArray(rows)) return [];
  return Array.from(new Set(rows.flatMap((row) => {
    if (!row || typeof row !== "object" || !("id" in row)) return [];
    const id = String((row as { id?: unknown }).id || "").trim();
    return id && id.length <= MODEL_CONFIG_LIMITS.model && !/\s/.test(id) ? [id] : [];
  }))).sort((a, b) => a.localeCompare(b)).slice(0, 500);
}

async function checkCompletion(baseUrl: string, model: string, apiKey: string) {
  const endpoint = await assertSafeResolvedFetchUrl(modelApiUrl(baseUrl, "chat/completions"));
  const response = await fetchWithTimeout(endpoint.toString(), {
    method: "POST",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      model,
      // One token frequently gets consumed by reasoning and produces
      // content:null + finish_reason:length. A small real response budget lets
      // this probe distinguish a usable content channel from that false positive.
      max_tokens: 2048,
      ...providerThinkingOptions({ baseUrl, model }, true),
      messages: [
        { role: "system", content: "Return a short plain-text answer." },
        { role: "user", content: "Reply OK." }
      ]
    })
  }, 60_000);
  const text = await readLimitedModelResponse(response, MODEL_COMPLETION_RESPONSE_LIMIT);
  if (!response.ok) throw new Error(safeModelProviderHttpError(response.status, text, [apiKey]));
  let payload: { choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown }; finish_reason?: unknown }> };
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    throw new Error("服务已响应，但没有返回有效的 OpenAI Chat Completions 正文；请核对模型、API 类型与输出预算。 ");
  }
  const choice = payload.choices?.[0];
  const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : "unknown";
  const content = typeof choice?.message?.content === "string" ? choice.message.content.trim() : "";
  const reasoning = typeof choice?.message?.reasoning_content === "string"
    ? choice.message.reasoning_content.trim()
    : "";
  if (finishReason === "length" || finishReason === "max_tokens") {
    // The provider accepted the authenticated Chat Completions request and the
    // selected model, but a reasoning model spent the small probe budget before
    // emitting content. Report this as a qualified connection success instead
    // of the misleading “model unavailable” error that frustrated admins.
    return { finishReason, hasContent: Boolean(content) };
  }
  if (!content && !reasoning) throw new Error(`模型服务没有返回可用正文（finish_reason=${finishReason}）。`);
  return { finishReason, hasContent: Boolean(content) };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 25_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Never follow an authenticated redirect: forwarding Authorization to a
    // provider-controlled second origin could disclose the administrator key.
    return await safeFetch(url, { ...init, signal: controller.signal }, { maxRedirects: 0 });
  } finally {
    clearTimeout(timeout);
  }
}

function safeProbeError(error: unknown) {
  if (error instanceof ModelConfigValidationError) {
    return error.code === "invalid_base_url"
      ? "Base URL 无效：为保护 API Key，仅允许完整的公网 HTTPS 地址。"
      : "Base URL 不可用：地址中不能包含凭据、查询参数或片段。";
  }
  if (error instanceof Error && error.name === "AbortError") return "连接检查超时（模型验证最长 60 秒，模型列表最长 25 秒）。";
  const message = error instanceof Error ? error.message : String(error);
  if (/内网|保留|不允许|协议|无法解析|URL/.test(message)) {
    return `Base URL 不可用：${message.slice(0, 240)}`;
  }
  if (message.startsWith("供应商") || message.startsWith("服务") || message.startsWith("模型")) {
    return message.slice(0, 300).trim();
  }
  return "连接检查失败，请核对 Base URL、API Key 和模型 ID。";
}

function jsonError(error: string, status: number) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}
