import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureBackendCallerAllowed } from "@/lib/sync/backend-auth";
import { scoreCreativeWork } from "@/lib/creation-ai";
import { contentFingerprint, parseGenreDimensions, type ScoreDetail } from "@/lib/creation";
import {
  actorOwnsWork,
  checkCreationAiBudget,
  getCreationActor,
  serializeWorkForOwner
} from "@/lib/creation-server";

export const dynamic = "force-dynamic";

// AI 评分：按题材标尺逐维打分。评分不是过/不过的门槛，
// 未达标会给出指向原文的具体反馈，创作者修改后可重新提交。
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await ensureBackendCallerAllowed(request);
  if (denied) return denied;

  const budget = await checkCreationAiBudget(request, "creation-score", 12);
  if (budget) return budget;

  const work = await prisma.creativeWork.findUnique({ where: { id }, include: { genre: true } });
  if (!work || !actorOwnsWork(work, await getCreationActor())) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  }
  if (work.status !== "DRAFT") {
    return NextResponse.json({ error: "只有草稿可以评分" }, { status: 409 });
  }
  if (!work.content.trim()) {
    return NextResponse.json({ error: "草稿内容为空，无法评分" }, { status: 409 });
  }

  const dimensions = parseGenreDimensions(work.genre.dimensions);
  if (dimensions.length === 0) {
    return NextResponse.json({ error: "该题材未配置评分维度，请联系管理员" }, { status: 500 });
  }

  let result: Awaited<ReturnType<typeof scoreCreativeWork>>;
  try {
    result = await scoreCreativeWork({
      genreName: work.genre.name,
      dimensions,
      threshold: work.genre.threshold,
      title: work.title,
      content: work.content
    });
  } catch (error) {
    console.error("[creation-score] AI call failed:", error);
    return NextResponse.json({ error: "AI 评审暂时失败，请稍后重试（草稿内容不受影响）" }, { status: 502 });
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

  const updated = await prisma.creativeWork.update({
    where: { id: work.id },
    data: {
      score: result.total,
      scoreDetail: JSON.stringify(detail),
      scoredAt: new Date(),
      scoredHash: contentFingerprint(work.content)
    },
    include: { genre: true }
  });

  return NextResponse.json({ work: serializeWorkForOwner(updated) });
}
