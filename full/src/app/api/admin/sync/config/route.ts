import { encryptSecret } from "@/lib/crypto";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import {
  normalizeBackendUrl,
  normalizeSyncIntervalMinutes,
  normalizeSyncMode,
} from "@/lib/sync/config";

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();

  const syncToken = String(form.get("syncToken") || "").trim();
  const clearSyncToken = form.get("clearSyncToken") === "true";
  const update: Record<string, unknown> = {
    syncMode: normalizeSyncMode(form.get("syncMode")),
    syncBackendUrl: normalizeBackendUrl(form.get("syncBackendUrl")),
    syncIntervalMinutes: normalizeSyncIntervalMinutes(form.get("syncIntervalMinutes")),
  };

  if (syncToken) {
    update.syncTokenEnc = encryptSecret(syncToken.slice(0, 1000));
  } else if (clearSyncToken) {
    update.syncTokenEnc = null;
  }

  await prisma.siteSettings.upsert({
    where: { id: "site" },
    update,
    create: {
      id: "site",
      name: "拾贝 信息博客",
      description: "抓取信息、AI 整理、人工审核发布的个人博客。",
      ownerName: "管理员",
      ...(update as Record<string, never>),
    },
  });

  return redirectTo("/admin/sync", request);
}
