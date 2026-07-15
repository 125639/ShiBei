import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensureBackendCallerAllowed } from "@/lib/sync/backend-auth";
import {
  PublicVerificationRequiredError,
  buildCreativeDraftFallback,
  composeCreativeDraft,
  formatVerificationClarificationQuestion,
  isVerificationClarificationQuestion
} from "@/lib/creation-ai";
import {
  AnonymousComposeReservationError,
  releaseAnonymousComposeSlot,
  reserveAnonymousComposeSlot
} from "@/lib/anon-compose-quota";
import {
  ANON_WORK_LIMIT,
  CREATION_DEPTHS,
  parseGenreDimensions,
  parseInterview,
  scoreInvalidationData,
  verificationClarificationData,
  workRevisionWhere
} from "@/lib/creation";
import {
  actorOwnsWork,
  checkCreationAiBudget,
  getClientIp,
  getCreationActor,
  serializeWorkForOwner
} from "@/lib/creation-server";
import { MAX_SCORABLE_WORK_CONTENT_LENGTH } from "@/lib/creation-limits";
import { parseJsonBody } from "@/lib/request-validation";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ expectedUpdatedAt: z.string().datetime() });

// 把访谈素材生成为「可编辑草稿」——生成后不直接存档，
// 内容始终经创作者本人过目、修改并主动发布才算数。
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
      { error: "作品已在其他页面变化，请刷新并确认最新内容后再成稿" },
      { status: 409 }
    );
  }
  if (work.mode === "MANUAL") {
    return NextResponse.json({ error: "纯手写作品不能调用 AI 成稿" }, { status: 409 });
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

  if (work.pendingQuestion && isVerificationClarificationQuestion(work.pendingQuestion)) {
    return NextResponse.json(
      { error: "请先回答联网核验提出的澄清问题，再重新成稿" },
      { status: 409 }
    );
  }

  // 匿名首次成稿在长 AI 调用之前原子占位。同 IP 的计数与占位由数据库锁
  // 串行化，不能再用多个并发 compose 同时穿透上限。
  let reservation: Date | null = null;
  if (!work.ownerId && !work.draftGeneratedAt) {
    try {
      reservation = await reserveAnonymousComposeSlot({
        workId: work.id,
        clientIp: work.clientIp || getClientIp(request)
      });
    } catch (error) {
      if (error instanceof AnonymousComposeReservationError) {
        if (error.reason === "quota") {
          return NextResponse.json(
            { error: `未登录状态下单个 IP 最多生成 ${ANON_WORK_LIMIT} 篇文章。登录状态下新建作品后可继续创作。` },
            { status: 403 }
          );
        }
        return NextResponse.json(
          {
            error: error.reason === "in_progress"
              ? "这篇作品正在成稿，请等待当前任务完成"
              : "作品刚刚发生变化，请刷新后重试"
          },
          { status: 409 }
        );
      }
      throw error;
    }
  }

  try {
    // 所有权、状态与匿名配额均通过后才占用 AI 预算。
    const budget = await checkCreationAiBudget(request, "creation-compose", 10);
    if (budget) return budget;

    let draft: Awaited<ReturnType<typeof composeCreativeDraft>>;
    let composeFallback = false;
    try {
      draft = await composeCreativeDraft({
        genreName: work.genre.name,
        genreDescription: work.genre.description,
        dimensions: parseGenreDimensions(work.genre.dimensions),
        threshold: work.genre.threshold,
        mode: work.mode,
        depth: work.depth,
        topic: work.topic,
        interview
      });
    } catch (error) {
      if (error instanceof PublicVerificationRequiredError) {
        const question = formatVerificationClarificationQuestion(error.issues);
        const claimed = await prisma.creativeWork.updateMany({
          where: workRevisionWhere(work),
          // 重新成稿时保留旧 title/summary/content，只把状态退回访谈以便回答；
          // 旧评分已不能代表核验后的下一稿，必须同步失效。
          data: { ...verificationClarificationData(work.status, question), composeReservedAt: null }
        });
        if (claimed.count === 0) {
          return NextResponse.json(
            { error: "核验期间作品已发生变化，未覆盖当前草稿，请刷新后重试" },
            { status: 409 }
          );
        }
        const updated = await prisma.creativeWork.findUnique({ where: { id: work.id }, include: { genre: true } });
        if (!updated) return NextResponse.json({ error: "作品不存在" }, { status: 404 });
        return NextResponse.json(
          {
            error: "联网核验发现需要整改或解释的公开事实，请先补充说明后再成稿。",
            work: await serializeWorkForOwner(updated),
            composeNotes: [question]
          },
          { status: 409 }
        );
      }
      console.error("[creation-compose] AI call failed:", error);
      draft = buildCreativeDraftFallback({ topic: work.topic, interview });
      composeFallback = true;
    }

    if (draft.content.length > MAX_SCORABLE_WORK_CONTENT_LENGTH) {
      return NextResponse.json(
        { error: `AI 草稿超过 ${MAX_SCORABLE_WORK_CONTENT_LENGTH} 个字符，无法保证全文评分，请重试成稿` },
        { status: 502 }
      );
    }

    const generatedAt = new Date();
    const claimed = await prisma.$transaction(async (tx) => {
      const updated = await tx.creativeWork.updateMany({
        // 成稿是长任务，写回时必须仍是调用开始时看到的版本；否则会覆盖并发编辑，
        // 也可能在发布 CAS 之后把已公开内容换成未评分的新稿。
        where: workRevisionWhere(work),
        data: {
          title: draft.title,
          summary: draft.summary,
          content: draft.content,
          status: "DRAFT",
          draftGeneratedAt: generatedAt,
          composeReservedAt: null,
          pendingQuestion: null,
          // 重新生成后旧评分作废
          ...scoreInvalidationData()
        }
      });
      if (updated.count === 1 && reservation) {
        // 与草稿写入同成同败。账本不关联作品外键，用户以后删除草稿也不会
        // 恢复已经消费的匿名生成名额。
        await tx.anonymousComposeUsage.create({
          data: {
            clientIp: work.clientIp || getClientIp(request),
            workId: work.id,
            createdAt: generatedAt
          }
        });
      }
      return updated;
    });
    if (claimed.count === 0) {
      return NextResponse.json(
        { error: "成稿期间作品已在其他页面变化，本次结果未覆盖当前内容，请刷新后重试" },
        { status: 409 }
      );
    }
    const updated = await prisma.creativeWork.findUnique({ where: { id: work.id }, include: { genre: true } });
    if (!updated) return NextResponse.json({ error: "作品不存在" }, { status: 404 });

    // 审校/歧义提示随草稿返回（不入库——它们是给创作者本次过目用的一次性信息）
    return NextResponse.json({
      work: await serializeWorkForOwner(updated),
      composeNotes: draft.notes,
      composeFallback
    });
  } finally {
    await releaseAnonymousComposeSlot(work.id, reservation).catch((error) => {
      console.error("[creation-compose] failed to release anonymous quota reservation:", error);
    });
  }
}
