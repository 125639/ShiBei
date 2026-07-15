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

export function buildModelFallbackChain<T extends { id: string }>(
  configs: T[],
  primaryId: string
): (T & { fallbackConfigs: T[] }) | null {
  const primary = configs.find((config) => config.id === primaryId);
  return primary
    ? { ...primary, fallbackConfigs: configs.filter((config) => config.id !== primary.id) }
    : null;
}

export async function getModelConfigForUse(use: ModelUse) {
  const [settings, configs] = await Promise.all([
    prisma.siteSettings.findUnique({
      where: { id: "site" },
      select: {
        contentModelConfigId: true,
        assistantModelConfigId: true,
        writingModelConfigId: true,
        translationModelConfigId: true
      }
    }).catch(() => null),
    prisma.modelConfig.findMany({
      where: { isEnabled: true },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }, { id: "asc" }]
    })
  ]);
  const site = settings as SiteModelFields | null;
  const configuredId = site?.[MODEL_FIELD_BY_USE[use]];
  let primary = configuredId ? configs.find((config) => config.id === configuredId) : null;

  if (!primary && use === "translation" && site?.assistantModelConfigId) {
    primary = configs.find((config) => config.id === site.assistantModelConfigId) || null;
  }
  primary ||= configs[0] || null;
  if (!primary) return null;

  // Role-selected calls may transparently fail over only after a retryable
  // provider/network failure. Explicit benchmark/job configs do not carry this
  // list, so model comparisons and pinned jobs remain attributable to one model.
  return buildModelFallbackChain(configs, primary.id);
}

/**
 * Durable worker jobs remember the connection selected when they were queued,
 * but a transient outage must not make every retry hit that same dead service.
 * Keep the remembered model first for attribution/reproducibility, then attach
 * the other configured connections as runtime fallbacks. Direct benchmarks and
 * the admin's explicit connection probe still pass a bare config and stay
 * pinned to exactly one model.
 */
export async function getQueuedModelConfigForUse(modelConfigId: string) {
  const configs = await prisma.modelConfig.findMany({
    where: { isEnabled: true },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }, { id: "asc" }]
  });
  return buildModelFallbackChain(configs, modelConfigId);
}
