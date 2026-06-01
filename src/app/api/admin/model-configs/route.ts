import { requireAdmin } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { MODEL_PROVIDER_PRESETS } from "@/lib/model-providers";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

function clampNumber(value: FormDataEntryValue | null, fallback: number, min: number, max: number) {
  const n = Number(value || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const isDefault = form.get("isDefault") === "true";
  const provider = String(form.get("provider") || "custom");
  const preset = MODEL_PROVIDER_PRESETS.find((item) => item.key === provider);

  if (isDefault) {
    await prisma.modelConfig.updateMany({ data: { isDefault: false } });
  }

  await prisma.modelConfig.create({
    data: {
      name: String(form.get("name") || "默认模型"),
      provider: preset?.key || "custom",
      baseUrl: String(form.get("baseUrl") || preset?.baseUrl || "https://api.openai.com/v1"),
      model: String(form.get("model") || preset?.model || "gpt-4o-mini"),
      apiKeyEnc: encryptSecret(String(form.get("apiKey") || "")),
      temperature: clampNumber(form.get("temperature"), 0.3, 0, 2),
      maxTokens: clampNumber(form.get("maxTokens"), 1600, 1, 200000),
      stream: form.get("stream") === "true",
      isDefault
    }
  });

  return redirectTo("/admin/settings?tab=models");
}
