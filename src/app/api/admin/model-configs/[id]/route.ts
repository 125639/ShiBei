import { requireAdmin } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import {
  ModelConfigValidationError,
  canReuseSavedModelKey,
  parseModelConfigForm,
  replaceSiteModelReferences
} from "@/lib/model-config-input";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { assertSafeFetchUrl } from "@/lib/url-safety";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin();
  const { id } = await params;
  const form = await request.formData();
  const intent = String(form.get("_intent") || "update");

  if (intent === "delete") {
    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.modelConfig.findUnique({ where: { id } });
        if (!current) throw new ModelConfigValidationError("not_found");
        const replacement = await tx.modelConfig.findFirst({
          where: { id: { not: id }, isEnabled: true },
          orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }, { id: "asc" }]
        });
        const replacementId = replacement?.id || null;
        const site = await tx.siteSettings.findUnique({
          where: { id: "site" },
          select: {
            contentModelConfigId: true,
            assistantModelConfigId: true,
            writingModelConfigId: true,
            translationModelConfigId: true
          }
        });
        const sitePatch = replaceSiteModelReferences(site, id, replacementId);
        if (Object.keys(sitePatch).length) {
          await tx.siteSettings.update({ where: { id: "site" }, data: sitePatch });
        }
        // FetchJob intentionally stores a snapshot reference rather than a FK.
        // Repoint queued work and history so a removed typo/config never leaves
        // jobs looking up an ID that can no longer exist.
        await tx.fetchJob.updateMany({
          where: { modelConfigId: id },
          data: { modelConfigId: replacementId }
        });
        await tx.modelConfig.delete({ where: { id } });
        if (replacement && (current.isDefault || !replacement.isDefault)) {
          await tx.modelConfig.update({ where: { id: replacement.id }, data: { isDefault: true } });
        }
      });
      return redirectTo("/admin/settings?tab=models&modelStatus=deleted", request);
    } catch (error) {
      const code = error instanceof ModelConfigValidationError ? error.code : "delete_failed";
      return redirectTo(`/admin/settings?tab=models&modelError=${encodeURIComponent(code)}`, request);
    }
  }

  try {
    const input = parseModelConfigForm(form, { requireApiKey: false });
    assertSafeFetchUrl(input.baseUrl);
    await prisma.$transaction(async (tx) => {
      const current = await tx.modelConfig.findUnique({ where: { id } });
      if (!current) throw new ModelConfigValidationError("not_found");
      if (!input.apiKey && !canReuseSavedModelKey(current.baseUrl, input.baseUrl)) {
        // Never carry a credential across origins/paths. Otherwise changing the
        // URL while leaving Key blank would send the old provider's secret to
        // the newly entered endpoint on the next request.
        throw new ModelConfigValidationError("api_key_required_for_endpoint_change", "apiKey");
      }
      const other = await tx.modelConfig.findFirst({
        where: { id: { not: id }, isEnabled: true },
        orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }, { id: "asc" }]
      });
      // Only an enabled connection can be the runtime default. Disabling the
      // current default promotes the best enabled alternative; disabling the
      // last active connection intentionally pauses AI features without
      // deleting its credentials.
      const keepAsDefault = input.isEnabled && (input.isDefault || !other);
      if (keepAsDefault) {
        await tx.modelConfig.updateMany({
          where: { id: { not: id } },
          data: { isDefault: false }
        });
      } else {
        // The database enforces at most one default. When demoting the current
        // default, clear it before promoting its deterministic replacement so
        // the transaction never temporarily contains two default rows.
        if (current.isDefault) {
          await tx.modelConfig.update({ where: { id }, data: { isDefault: false } });
        }
        if (other && !other.isDefault) {
          await tx.modelConfig.update({ where: { id: other.id }, data: { isDefault: true } });
        }
      }
      if (!input.isEnabled) {
        const site = await tx.siteSettings.findUnique({
          where: { id: "site" },
          select: {
            contentModelConfigId: true,
            assistantModelConfigId: true,
            writingModelConfigId: true,
            translationModelConfigId: true
          }
        });
        const replacementId = other?.id || null;
        const sitePatch = replaceSiteModelReferences(site, id, replacementId);
        if (Object.keys(sitePatch).length) {
          await tx.siteSettings.update({ where: { id: "site" }, data: sitePatch });
        }
        // Jobs that have not started (or are waiting for an explicit retry)
        // must not revive a connection the administrator just disabled.
        await tx.fetchJob.updateMany({
          where: { modelConfigId: id, status: { in: ["QUEUED", "FAILED"] } },
          data: { modelConfigId: replacementId }
        });
      }
      await tx.modelConfig.update({
        where: { id },
        data: {
          provider: input.provider,
          name: input.name,
          baseUrl: input.baseUrl,
          model: input.model,
          temperature: input.temperature,
          maxTokens: input.maxTokens,
          isEnabled: input.isEnabled,
          isDefault: keepAsDefault,
          ...(input.apiKey ? { apiKeyEnc: encryptSecret(input.apiKey) } : {})
        }
      });
    });
    return redirectTo("/admin/settings?tab=models&modelStatus=updated", request);
  } catch (error) {
    const code = error instanceof ModelConfigValidationError
      ? error.code
      : error instanceof Error && /不允许|内网|保留|协议|URL/.test(error.message)
        ? "unsafe_base_url"
        : "save_failed";
    return redirectTo(`/admin/settings?tab=models&modelError=${encodeURIComponent(code)}`, request);
  }
}
