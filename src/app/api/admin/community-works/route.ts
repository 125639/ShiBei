import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  CommunityModerationError,
  SHARED_COMMUNITY_WORK_WHERE,
  requireCommunityModerator
} from "@/lib/community-moderation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    requireCommunityModerator(await getSession());
  } catch (error) {
    if (error instanceof CommunityModerationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  // 这是治理后台唯一的作品列表查询，硬编码 SHARED；不得为了“方便管理”放宽为
  // ownerId/anonId 或全状态查询，否则管理员会读到会员及匿名用户的私有草稿。
  const [works, audits] = await Promise.all([
    prisma.creativeWork.findMany({
      where: SHARED_COMMUNITY_WORK_WHERE,
      orderBy: { publishedAt: "desc" },
      take: 200,
      select: {
        id: true,
        slug: true,
        title: true,
        summary: true,
        mode: true,
        score: true,
        publishedAt: true,
        ownerId: true,
        owner: { select: { displayName: true, username: true } },
        genre: { select: { name: true } }
      }
    }),
    prisma.communityModerationLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { admin: { select: { username: true } } }
    })
  ]);

  return NextResponse.json({
    works: works.map((work) => ({
      id: work.id,
      slug: work.slug,
      title: work.title,
      summary: work.summary,
      mode: work.mode,
      score: work.score,
      publishedAt: work.publishedAt?.toISOString() ?? null,
      isAnonymous: work.ownerId === null,
      author: work.owner ? work.owner.displayName || work.owner.username || "注册创作者" : "匿名创作者",
      genreName: work.genre.name
    })),
    audits: audits.map((audit) => ({
      id: audit.id,
      action: audit.action,
      reason: audit.reason,
      targetWorkId: audit.targetWorkId,
      titleSnapshot: audit.titleSnapshot,
      summarySnapshot: audit.summarySnapshot,
      slugSnapshot: audit.slugSnapshot,
      wasAnonymous: audit.wasAnonymous,
      adminUsername: audit.admin.username,
      createdAt: audit.createdAt.toISOString()
    }))
  });
}
