import { requireAdmin } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

function clampNumber(value: FormDataEntryValue | null, fallback: number, min: number, max: number) {
  const n = Number(value || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin();
  const { id } = await params;
  const form = await request.formData();
  const isDefault = form.get("isDefault") === "true";
  const apiKey = String(form.get("apiKey") || "").trim();

  if (isDefault) {
    await prisma.modelConfig.updateMany({ data: { isDefault: false } });
  }

  await prisma.modelConfig.update({
    where: { id },
    data: {
      name: String(form.get("name") || "默认模型").trim() || "默认模型",
      baseUrl: String(form.get("baseUrl") || "https://api.openai.com/v1").trim(),
      model: String(form.get("model") || "gpt-4o-mini").trim(),
      temperature: clampNumber(form.get("temperature"), 0.3, 0, 2),
      maxTokens: clampNumber(form.get("maxTokens"), 1600, 1, 200000),
      stream: form.get("stream") === "true",
      isDefault,
      ...(apiKey ? { apiKeyEnc: encryptSecret(apiKey) } : {})
    }
  });

  return redirectTo("/admin/settings?tab=models");
}
