import { AdminShell } from "@/components/AdminShell";
import { I18nText } from "@/components/I18nText";
import { SettingsClient } from "./SettingsClient";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { reportStorage, formatBytes } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdmin();
  const [site, modelConfigs, styles, admin, storage] = await Promise.all([
    prisma.siteSettings.findUnique({ where: { id: "site" } }),
    prisma.modelConfig.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.summaryStyle.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.adminUser.findFirst({ orderBy: { createdAt: "asc" } }),
    reportStorage().catch(() => null)
  ]);

  const s = site as Record<string, unknown> | null;

  const storageProps = storage ? {
    uploadsBytes: formatBytes(storage.uploadsBytes),
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
      <p className="eyebrow"><I18nText zh="设置" en="Settings" /></p>
      <h1 style={{ marginBottom: "28px" }}><I18nText zh="设置" en="Settings" /></h1>

      <SettingsClient
        site={s}
        modelConfigs={modelConfigs}
        styles={styles}
        admin={admin}
        storage={storageProps}
      />
    </AdminShell>
  );
}