import { AdminShell } from "@/components/AdminShell";
import { I18nText } from "@/components/I18nText";
import { SettingsClient } from "./SettingsClient";
import { hasLocalWorker } from "@/lib/app-mode";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { reportStorage, formatBytes } from "@/lib/storage";

export const dynamic = "force-dynamic";

function queryCount(value: string | string[] | undefined) {
  const parsed = Number(typeof value === "string" ? value : 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export default async function SettingsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdmin();
  const workerEnabled = hasLocalWorker();
  const params = await searchParams;
  const initialTab = typeof params.tab === "string" ? params.tab : "site";
  const savedFlag = params.saved === "1";
  const modelStatus = typeof params.modelStatus === "string" ? params.modelStatus : undefined;
  const modelError = typeof params.modelError === "string" ? params.modelError : undefined;
  const accountError = typeof params.accountError === "string" ? params.accountError : undefined;
  const cleanupResult = params.cleanup === "success"
    ? {
        status: "success" as const,
        fetchJobsDeleted: queryCount(params.jobs),
        rawItemsDeleted: queryCount(params.raw),
        archivedPosts: queryCount(params.posts),
        videoFilesDeleted: queryCount(params.videos),
        bytesFreed: formatBytes(queryCount(params.bytes))
      }
    : params.cleanup === "error"
      ? { status: "error" as const }
      : undefined;
  const [site, modelConfigs, styles, admin, storage] = await Promise.all([
    prisma.siteSettings.findUnique({
      where: { id: "site" },
      select: {
        name: true,
        description: true,
        ownerName: true,
        defaultTheme: true,
        defaultFont: true,
        defaultLanguage: true,
        defaultSettingsUI: true,
        autoPublish: true,
        contentLanguageMode: true,
        globalPromptPrefix: true,
        contentModelConfigId: true,
        assistantModelConfigId: true,
        writingModelConfigId: true,
        translationModelConfigId: true,
        autoImageSearchEnabled: true,
        textOnlyMode: true,
        videosEnabled: true,
        commentsEnabled: true,
        musicEnabledDefault: true,
        maxStorageMb: true,
        cleanupAfterDays: true,
        cleanupCustomEnabled: true,
        exaEnabled: true,
        // Read only to derive a boolean below; the encrypted secret is never
        // passed through the Server Component boundary into browser payloads.
        exaApiKeyEnc: true
      }
    }),
    prisma.modelConfig.findMany({
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        provider: true,
        name: true,
        baseUrl: true,
        model: true,
        temperature: true,
        maxTokens: true,
        isEnabled: true,
        isDefault: true
      }
    }),
    prisma.contentStyle.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        contentMode: true,
        tone: true,
        length: true,
        focus: true,
        outputStructure: true,
        customInstructions: true,
        isDefault: true
      }
    }),
    prisma.adminUser.findUnique({
      where: { id: session.userId },
      select: { username: true }
    }),
    reportStorage().catch(() => null)
  ]);

  const siteProps = site
    ? (({ exaApiKeyEnc, ...safe }) => ({ ...safe, exaConfigured: Boolean(exaApiKeyEnc) }))(site)
    : null;

  const storageProps = storage ? {
    uploadsBytes: formatBytes(storage.uploadsBytes),
    imageBytes: formatBytes(storage.imageBytes),
    musicBytes: formatBytes(storage.musicBytes),
    videoBytes: formatBytes(storage.videoBytes),
    postCount: storage.postCount,
    rawItemCount: storage.rawItemCount,
    fetchJobCount: storage.fetchJobCount,
    approxDbBytesEstimate: formatBytes(storage.approxDbBytesEstimate),
    maxStorageMb: storage.maxStorageMb,
    cleanupAfterDays: storage.cleanupAfterDays
  } : null;

  return (
    <AdminShell>
      <p className="eyebrow"><I18nText zh="Settings" en="Settings" /></p>
      <h1 style={{ marginBottom: "28px" }}><I18nText zh="系统设置" en="System Settings" /></h1>

      <SettingsClient
        site={siteProps}
        modelConfigs={modelConfigs}
        styles={styles}
        admin={admin}
        storage={storageProps}
        initialTab={initialTab}
        savedFlag={savedFlag}
        modelStatus={modelStatus}
        modelError={modelError}
        accountError={accountError}
        cleanupResult={cleanupResult}
        workerEnabled={workerEnabled}
      />
    </AdminShell>
  );
}
