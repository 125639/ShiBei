import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  CommunityModerationError,
  CommunityModerationRequestSchema,
  SHARED_COMMUNITY_WORK_WHERE,
  moderateSharedCommunityWork,
  requireCommunityModerator
} from "@/lib/community-moderation";
import { scoreInvalidationData } from "@/lib/creation";
import { prisma } from "@/lib/prisma";
import { parseJsonBody } from "@/lib/request-validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let adminId: string;
  try {
    adminId = requireCommunityModerator(await getSession());
  } catch (error) {
    if (error instanceof CommunityModerationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const parsed = await parseJsonBody(request, CommunityModerationRequestSchema);
  if (!parsed.ok) return parsed.response;
  const { id } = await params;

  let result: Awaited<ReturnType<typeof moderateSharedCommunityWork>>;
  try {
    result = await prisma.$transaction(async (tx) =>
      moderateSharedCommunityWork({
        adminId,
        workId: id,
        action: parsed.data.action,
        reason: parsed.data.reason,
        store: {
          async findSharedWork(workId) {
            const work = await tx.creativeWork.findFirst({
              where: { id: workId, ...SHARED_COMMUNITY_WORK_WHERE },
              // 公开表面只在事务内用于计算治理指纹；正文绝不写入审计或响应。
              select: {
                id: true,
                title: true,
                summary: true,
                content: true,
                slug: true,
                ownerId: true
              }
            });
            return work ? { ...work, status: "SHARED" as const } : null;
          },
          async unpublishSharedWork(workId, surface) {
            // 每个历史表面只写一次且永不覆盖原因。重复治理同一表面仍由审计日志
            // 记录本次动作；唯一键 + skipDuplicates 让并发请求安全收敛。
            await tx.communityModeratedSurface.createMany({
              data: [{ workId, ...surface }],
              skipDuplicates: true
            });
            const changed = await tx.creativeWork.updateMany({
              where: { id: workId, ...SHARED_COMMUNITY_WORK_WHERE },
              data: {
                status: "DRAFT",
                slug: null,
                publishedAt: null,
                ...scoreInvalidationData()
              }
            });
            return changed.count === 1;
          },
          async deleteSharedWork(workId) {
            // 只锁定这份私有原稿的再次社区交接，不读取也不删除原稿内容。随后删除
            // 公开副本时，FK 的 ON DELETE SET NULL 会解除绑定，让原稿仍可编辑/导出。
            await tx.writingDoc.updateMany({
              where: { creativeWorkId: workId },
              data: { publicationBlockedAt: new Date() }
            });
            const changed = await tx.creativeWork.deleteMany({
              where: { id: workId, ...SHARED_COMMUNITY_WORK_WHERE }
            });
            return changed.count === 1;
          },
          async createAudit(data) {
            await tx.communityModerationLog.create({ data });
          }
        }
      })
    );

  } catch (error) {
    if (error instanceof CommunityModerationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[community-moderation] action failed:", error);
    return NextResponse.json({ error: "治理操作失败，作品和审计记录均未改变" }, { status: 500 });
  }

  // 详情页使用 community-content 标签缓存；治理成功必须立即让旧 slug 失效。
  try {
    revalidateTag("community-content", { expire: 0 });
  } catch (error) {
    // 数据库事务已经提交，不能谎称作品未改变或诱导管理员重复操作。
    console.error("[community-moderation] cache invalidation failed:", error);
    return NextResponse.json({
      ok: true,
      action: result.audit.action,
      audit: result.audit,
      warning: "治理和审计已保存，但社区缓存刷新失败，请立即检查公开页"
    });
  }
  return NextResponse.json({ ok: true, action: result.audit.action, audit: result.audit });
}
