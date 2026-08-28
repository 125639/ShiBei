import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseJsonBody } from "@/lib/request-validation";
import { slugify } from "@/lib/slug";
import { canPublishWork, publicationSnapshotWhere, workRubricFingerprint } from "@/lib/creation";
import {
  actorOwnsWork,
  findCurrentModeratedSurface,
  getCreationActor,
  serializeWorkForOwner
} from "@/lib/creation-server";
import { MAX_SCORABLE_WORK_CONTENT_LENGTH } from "@/lib/creation-limits";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  // 匿名发布必须显式确认「发布后不可删除」条款。
  confirmAnonymousNoDelete: z.boolean().optional().default(false),
  expectedUpdatedAt: z.string().datetime()
});

// 公开作品：只有创作者点击发布才会公开（默认私有），
// 且必须满足：已评分、内容与评分时一致、总分达到题材阈值。
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const work = await prisma.creativeWork.findUnique({ where: { id }, include: { genre: true } });
  if (!work || !actorOwnsWork(work, await getCreationActor())) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  }
  const parsed = await parseJsonBody(request, BodySchema);
  if (!parsed.ok) return parsed.response;
  if (work.updatedAt.toISOString() !== parsed.data.expectedUpdatedAt) {
    return NextResponse.json(
      { error: "作品或评分已在其他页面变化，请刷新并确认最新版本后再发布" },
      { status: 409 }
    );
  }
  if (work.status === "SHARED") {
    return NextResponse.json({ error: "作品已经公开" }, { status: 409 });
  }
  if (work.status !== "DRAFT") {
    return NextResponse.json({ error: "请先完成访谈并生成草稿" }, { status: 409 });
  }
  if (work.content.length > MAX_SCORABLE_WORK_CONTENT_LENGTH) {
    return NextResponse.json(
      { error: `社区作品正文最多 ${MAX_SCORABLE_WORK_CONTENT_LENGTH} 个字符，当前内容无法完整评分和发布` },
      { status: 409 }
    );
  }

  const moderatedSurface = await findCurrentModeratedSurface(work);
  const gate = canPublishWork({
    score: work.score,
    threshold: work.genre.threshold,
    scoredHash: work.scoredHash,
    scoredRubricHash: work.scoredRubricHash,
    currentRubricHash: workRubricFingerprint(work),
    title: work.title,
    summary: work.summary,
    content: work.content,
    moderationBlocked: Boolean(moderatedSurface),
    moderationReason: moderatedSurface?.reason ?? null
  });
  if (!gate.ok) {
    return NextResponse.json({ error: gate.reason }, { status: 409 });
  }

  if (!work.ownerId && !parsed.data.confirmAnonymousNoDelete) {
    return NextResponse.json(
      {
        error: "匿名发布的作品发布后不可删除。请确认该条款后再发布，或注册账号以保留完整管理权。",
        requiresConfirmation: true
      },
      { status: 428 }
    );
  }

  const slug = `${slugify(work.title)}-${work.id.slice(-6)}`;
  const publishedAt = new Date();
  const claimed = await prisma.creativeWork.updateMany({
    // 原子 CAS：发布校验和状态更新必须针对同一个评分快照。任何并发 PATCH、
    // compose 或 score 都会改变 status/updatedAt，使旧发布请求命中 0 行。
    where: {
      ...publicationSnapshotWhere(work),
      // 评分闸门通过后若管理员并发调整题材标尺，发布 CAS 必须失败。
      genre: { updatedAt: work.genre.updatedAt }
    },
    data: {
      status: "SHARED",
      slug,
      publishedAt,
      // Never overwrite the first-publication fact on a later republication.
      publishedOnceAt: work.publishedOnceAt ?? publishedAt
    }
  });
  if (claimed.count === 0) {
    return NextResponse.json(
      { error: "草稿或评分刚刚发生变化，未发布任何内容，请刷新并重新确认" },
      { status: 409 }
    );
  }

  const updated = await prisma.creativeWork.findUnique({ where: { id: work.id }, include: { genre: true } });
  if (!updated) return NextResponse.json({ error: "作品不存在" }, { status: 404 });

  // 详情页缓存（见 /community/[slug]）：新作品立即可见，不等兜底刷新。
  revalidateTag("community-content", { expire: 0 });

  return NextResponse.json({ work: await serializeWorkForOwner(updated), url: `/community/${slug}` });
}
