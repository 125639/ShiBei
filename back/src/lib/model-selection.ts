import { prisma } from "./prisma";

export type ModelUse = "news" | "assistant" | "writing" | "translation";

type SiteModelFields = {
  newsModelConfigId?: string | null;
  assistantModelConfigId?: string | null;
  writingModelConfigId?: string | null;
  translationModelConfigId?: string | null;
};

export async function getModelConfigForUse(use: ModelUse) {
  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } }).catch(() => null);
  const site = settings as SiteModelFields | null;
  const configuredId = use === "news"
    ? site?.newsModelConfigId
    : use === "assistant"
      ? site?.assistantModelConfigId
      : use === "writing"
        ? site?.writingModelConfigId
        : site?.translationModelConfigId;

  if (configuredId) {
    const configured = await prisma.modelConfig.findUnique({ where: { id: configuredId } });
    if (configured) return configured;
  }

  if (use === "translation" && site?.assistantModelConfigId) {
    const assistant = await prisma.modelConfig.findUnique({ where: { id: site.assistantModelConfigId } });
    if (assistant) return assistant;
  }

  return (await prisma.modelConfig.findFirst({ where: { isDefault: true } })) || prisma.modelConfig.findFirst();
}
