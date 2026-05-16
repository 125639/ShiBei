import { prisma } from "./prisma";

export type ModelUse = "content" | "assistant" | "writing" | "translation";

type SiteModelFields = {
  contentModelConfigId?: string | null;
  assistantModelConfigId?: string | null;
  writingModelConfigId?: string | null;
  translationModelConfigId?: string | null;
};

const MODEL_FIELD_BY_USE: Record<ModelUse, keyof SiteModelFields> = {
  content: "contentModelConfigId",
  assistant: "assistantModelConfigId",
  writing: "writingModelConfigId",
  translation: "translationModelConfigId"
};

export async function getModelConfigForUse(use: ModelUse) {
  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } }).catch(() => null);
  const site = settings as SiteModelFields | null;
  const configuredId = site?.[MODEL_FIELD_BY_USE[use]];

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
