import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensureBackendCallerAllowed } from "@/lib/sync/backend-auth";
import { scoreCreativeWork, scoreCreativeWorkFallback } from "@/lib/creation-ai";
import {
  moderationBlockedMessage,
  parseGenreDimensions,
  scoredSurfaceRevisionWhere,
  workRubricFingerprint,
  workScoreFingerprint,
  type ScoreDetail
} from "@/lib/creation";
import {
  actorOwnsWork,
  checkCreationAiBudget,
  findCurrentModeratedSurface,
  getCreationActor,
  serializeWorkForOwner
} from "@/lib/creation-server";
import { MAX_SCORABLE_WORK_CONTENT_LENGTH } from "@/lib/creation-limits";
import { parseJsonBody } from "@/lib/request-validation";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ expectedUpdatedAt: z.string().datetime() });

// AI 评分：按题材标尺逐维打分。评分不是过/不过的门槛，
// 未达标会给出指向原文的具体反馈，创作者修改后可重新提交。
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await ensureBackendCallerAllowed(request);
  if (denied) return denied;

  const work = await prisma.creativeWork.findUnique({ where: { id }, include: { genre: true } });
  if (!work || !actorOwnsWork(work, await getCreationActor())) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  }
  const parsed = await parseJsonBody(request, BodySchema);
  if (!parsed.ok) return parsed.response;
  if (work.updatedAt.toISOString() !== parsed.data.expectedUpdatedAt) {
    return NextResponse.json(
      { error: "草稿已在其他页面变化，请刷新并确认最新内容后再评分" },
      { status: 409 }
    );
  }
  if (work.status !== "DRAFT") {
    return NextResponse.json({ error: "只有草稿可以评分" }, { status: 409 });
  }
  if (!work.content.trim()) {
    return NextResponse.json({ error: "草稿内容为空，无法评分" }, { status: 409 });
  }
  if (work.content.length > MAX_SCORABLE_WORK_CONTENT_LENGTH) {
    return NextResponse.json(
      { error: `评分必须覆盖全文，社区作品正文最多 ${MAX_SCORABLE_WORK_CONTENT_LENGTH} 个字符，请精简后重试` },
      { status: 409 }
    );
  }
  const moderatedSurface = await findCurrentModeratedSurface(work);
  if (moderatedSurface) {
    return NextResponse.json(
      { error: moderationBlockedMessage(moderatedSurface.reason) },
      { status: 409 }
    );
  }

  const dimensions = parseGenreDimensions(work.genre.dimensions);
  if (dimensions.length === 0) {
    return NextResponse.json({ error: "该题材未配置评分维度，请联系管理员" }, { status: 500 });
  }

  // 未授权或无效草稿不得消耗限流计数和全局每日 AI 配额。
  const budget = await checkCreationAiBudget(request, "creation-score", 12);
  if (budget) return budget;

  let result: Awaited<ReturnType<typeof scoreCreativeWork>>;
  let scoreFallback = false;
  try {
    result = await scoreCreativeWork({
      genreName: work.genre.name,
      dimensions,
      threshold: work.genre.threshold,
      depth: work.depth,
      title: work.title,
      summary: work.summary,
      content: work.content
    });
  } catch (error) {
    console.error("[creation-score] AI call failed:", error);
    result = scoreCreativeWorkFallback({ dimensions, depth: work.depth, content: work.content });
    scoreFallback = true;
  }

  const detail: ScoreDetail = {
    dimensions: dimensions.map((dim) => {
      const scored = result.dimensionScores.find((item) => item.key === dim.key);
      return {
        key: dim.key,
        label: dim.label,
        weight: dim.weight,
        score: scored?.score ?? 0,
        feedback: scored?.feedback ?? ""
      };
    }),
    total: result.total,
    threshold: work.genre.threshold,
    publishable: result.total >= work.genre.threshold,
    overallComment: result.overallComment,
    suggestions: result.suggestions
  };

  const claimed = await prisma.creativeWork.updateMany({
    // AI 调用期间若标题、摘要、正文、状态或任一其他写操作发生变化，旧评分不得落库。
    where: {
      ...scoredSurfaceRevisionWhere(work),
      // 评分期间管理员若调整题材标尺，旧提示所得分数不得落库。
      genre: { updatedAt: work.genre.updatedAt }
    },
    data: {
      score: result.total,
      scoreDetail: JSON.stringify(detail),
      scoredAt: new Date(),
      scoredHash: workScoreFingerprint(work),
      scoredRubricHash: workRubricFingerprint(work)
    }
  });
  if (claimed.count === 0) {
    return NextResponse.json(
      { error: "评分期间草稿已发生变化，本次评分未保存，请重新提交" },
      { status: 409 }
    );
  }

  const updated = await prisma.creativeWork.findUnique({ where: { id: work.id }, include: { genre: true } });
  if (!updated) return NextResponse.json({ error: "作品不存在" }, { status: 404 });

  return NextResponse.json({ work: await serializeWorkForOwner(updated), scoreFallback });
}
