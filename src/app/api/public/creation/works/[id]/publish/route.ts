import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseJsonBody } from "@/lib/request-validation";
import { slugify } from "@/lib/slug";
import { canPublishWork } from "@/lib/creation";
import { actorOwnsWork, getCreationActor, serializeWorkForOwner } from "@/lib/creation-server";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  // 匿名发布必须显式确认「发布后不可删除」条款。
  confirmAnonymousNoDelete: z.boolean().optional().default(false)
});

// 公开作品：只有创作者点击发布才会公开（默认私有），
// 且必须满足：已评分、内容与评分时一致、总分达到题材阈值。
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(request, BodySchema);
  if (!parsed.ok) return parsed.response;

  const work = await prisma.creativeWork.findUnique({ where: { id }, include: { genre: true } });
  if (!work || !actorOwnsWork(work, await getCreationActor())) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  }
  if (work.status === "SHARED") {
    return NextResponse.json({ error: "作品已经公开" }, { status: 409 });
  }
  if (work.status !== "DRAFT") {
    return NextResponse.json({ error: "请先完成访谈并生成草稿" }, { status: 409 });
  }

  const gate = canPublishWork({
    score: work.score,
    threshold: work.genre.threshold,
    scoredHash: work.scoredHash,
    content: work.content
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
  const updated = await prisma.creativeWork.update({
    where: { id: work.id },
    data: { status: "SHARED", slug, publishedAt: new Date() },
    include: { genre: true }
  });

  return NextResponse.json({ work: serializeWorkForOwner(updated), url: `/community/${slug}` });
}
