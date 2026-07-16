import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAppMode } from "@/lib/app-mode";
import { getResolvedSyncConfig } from "@/lib/sync/config";
import { getSession } from "@/lib/auth";
import { SYNC_SCHEMA_VERSION } from "@/lib/sync/types";

// GET /api/admin/sync/probe
//
// 轻量探活端点：前端 sync-worker 每分钟调用一次，用来回答两个问题——
//   1. backend 可达且共享密钥正确吗？
//   2. 有没有比前端 lastImportedAt 更新的已发布内容（要不要拉 ZIP）？
//
// 相比直接拉增量 ZIP，这里只做两条 max(updatedAt) 查询 + 一个 count，
// 开销可忽略，因此前端可以用分钟级的频率轮询，让新内容近实时到达。
//
// 鉴权与 /api/admin/sync/export 完全一致：Bearer 共享密钥（机机）或管理员 session。
export async function GET(request: Request) {
  const cfg = await getResolvedSyncConfig();
  const auth = request.headers.get("authorization") || "";
  let authorized = false;
  if (cfg.syncToken && auth === `Bearer ${cfg.syncToken}`) {
    authorized = true;
  } else {
    const session = await getSession().catch(() => null);
    if (session) authorized = true;
  }
  if (!authorized) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const [latestPost, latestVideo, publishedCount] = await Promise.all([
    prisma.post
      .findFirst({
        where: { status: "PUBLISHED", publicationBlockedReason: null },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      })
      .catch(() => null),
    prisma.video
      .findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } })
      .catch(() => null),
    prisma.post
      .count({ where: { status: "PUBLISHED", publicationBlockedReason: null } })
      .catch(() => 0),
  ]);

  const stamps = [latestPost?.updatedAt, latestVideo?.updatedAt].filter(
    (d): d is Date => Boolean(d)
  );
  const latestContentAt = stamps.length
    ? new Date(Math.max(...stamps.map((d) => d.getTime())))
    : null;

  return NextResponse.json(
    {
      ok: true,
      appMode: getAppMode(),
      schemaVersion: SYNC_SCHEMA_VERSION,
      serverTime: new Date().toISOString(),
      latestContentAt: latestContentAt ? latestContentAt.toISOString() : null,
      publishedCount,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
