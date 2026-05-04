import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAppMode } from "@/lib/app-mode";
import { getResolvedSyncConfig } from "@/lib/sync/config";

// GET /api/admin/sync/status
// 返回当前同步配置 + 上次状态。
export async function GET() {
  await requireAdmin();
  const cfg = await getResolvedSyncConfig();
  const state = await prisma.syncState
    .findUnique({ where: { id: "sync" } })
    .catch(() => null);

  const [postCount, videoCount, publishedCount] = await Promise.all([
    prisma.post.count().catch(() => 0),
    prisma.video.count().catch(() => 0),
    prisma.post.count({ where: { status: "PUBLISHED" } }).catch(() => 0),
  ]);

  return NextResponse.json({
    appMode: getAppMode(),
    syncMode: cfg.mode,
    intervalMinutes: cfg.intervalMinutes,
    backendUrlConfigured: Boolean(cfg.backendUrl),
    syncTokenConfigured: Boolean(cfg.syncToken),
    backendUrlSource: cfg.backendUrlSource,
    syncTokenSource: cfg.syncTokenSource,
    state: state
      ? {
          lastImportedAt: state.lastImportedAt?.toISOString() || null,
          lastImportedPostCount: state.lastImportedPostCount,
          lastExportedAt: state.lastExportedAt?.toISOString() || null,
          lastError: state.lastError,
          updatedAt: state.updatedAt.toISOString(),
        }
      : null,
    counts: { postCount, videoCount, publishedCount },
  });
}
