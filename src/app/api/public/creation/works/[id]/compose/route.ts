import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureBackendCallerAllowed } from "@/lib/sync/backend-auth";
import { composeCreativeDraft } from "@/lib/creation-ai";
import { ANON_WORK_LIMIT, CREATION_DEPTHS, parseInterview } from "@/lib/creation";
import {
  actorOwnsWork,
  checkCreationAiBudget,
  countAnonGeneratedWorks,
  getClientIp,
  getCreationActor,
  serializeWorkForOwner
} from "@/lib/creation-server";

export const dynamic = "force-dynamic";

// 把访谈素材生成为「可编辑草稿」——生成后不直接存档，
// 内容始终经创作者本人过目、修改并主动发布才算数。
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await ensureBackendCallerAllowed(request);
  if (denied) return denied;

  const budget = await checkCreationAiBudget(request, "creation-compose", 10);
  if (budget) return budget;

  const work = await prisma.creativeWork.findUnique({ where: { id }, include: { genre: true } });
  if (!work || !actorOwnsWork(work, await getCreationActor())) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  }
  if (work.status === "SHARED") {
    return NextResponse.json({ error: "已公开的作品不可重新生成" }, { status: 409 });
  }

  const interview = parseInterview(work.interview);
  const config = CREATION_DEPTHS[work.depth];
  if (interview.length < config.minQuestions) {
    return NextResponse.json(
      { error: `${config.label}至少需要回答 ${config.minQuestions} 个问题，当前只回答了 ${interview.length} 个。` },
      { status: 409 }
    );
  }

  // 未登录生成配额：以「首次成稿」为准，单 IP 最多 ANON_WORK_LIMIT 篇。
  if (!work.ownerId && !work.draftGeneratedAt) {
    const used = await countAnonGeneratedWorks(work.clientIp || getClientIp(request));
    if (used >= ANON_WORK_LIMIT) {
      return NextResponse.json(
        { error: `未登录状态下单个 IP 最多生成 ${ANON_WORK_LIMIT} 篇文章。注册账号后可继续创作。` },
        { status: 403 }
      );
    }
  }

  let draft: Awaited<ReturnType<typeof composeCreativeDraft>>;
  try {
    draft = await composeCreativeDraft({
      genreName: work.genre.name,
      mode: work.mode,
      depth: work.depth,
      topic: work.topic,
      interview
    });
  } catch (error) {
    console.error("[creation-compose] AI call failed:", error);
    return NextResponse.json({ error: "AI 成稿暂时失败，请稍后重试（访谈记录已保存）" }, { status: 502 });
  }

  const updated = await prisma.creativeWork.update({
    where: { id: work.id },
    data: {
      title: draft.title,
      summary: draft.summary,
      content: draft.content,
      status: "DRAFT",
      draftGeneratedAt: new Date(),
      pendingQuestion: null,
      // 重新生成后旧评分作废
      score: null,
      scoreDetail: null,
      scoredAt: null,
      scoredHash: null
    },
    include: { genre: true }
  });

  // 审校/歧义提示随草稿返回（不入库——它们是给创作者本次过目用的一次性信息）
  return NextResponse.json({ work: serializeWorkForOwner(updated), composeNotes: draft.notes });
}
