import { requireAdmin } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { ModelConfigValidationError, parseModelConfigForm } from "@/lib/model-config-input";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { assertSafeFetchUrl } from "@/lib/url-safety";

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  try {
    const input = parseModelConfigForm(form, { requireApiKey: true });
    // Reject literal loopback/private hosts at save time. DNS is resolved and
    // pinned by the connection check and by every real model request.
    assertSafeFetchUrl(input.baseUrl);

    await prisma.$transaction(async (tx) => {
      const enabledCount = await tx.modelConfig.count({ where: { isEnabled: true } });
      const isDefault = input.isEnabled && (input.isDefault || enabledCount === 0);
      if (isDefault) await tx.modelConfig.updateMany({ data: { isDefault: false } });
      await tx.modelConfig.create({
        data: {
          provider: input.provider,
          name: input.name,
          baseUrl: input.baseUrl,
          model: input.model,
          apiKeyEnc: encryptSecret(input.apiKey),
          temperature: input.temperature,
          maxTokens: input.maxTokens,
          isEnabled: input.isEnabled,
          isDefault
        }
      });
    });

    return redirectTo("/admin/settings?tab=models&modelStatus=created", request);
  } catch (error) {
    const code = error instanceof ModelConfigValidationError
      ? error.code
      : error instanceof Error && /不允许|内网|保留|协议|URL/.test(error.message)
        ? "unsafe_base_url"
        : "save_failed";
    return redirectTo(`/admin/settings?tab=models&modelError=${encodeURIComponent(code)}`, request);
  }
}
