import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseJsonBody } from "@/lib/request-validation";
import { ensureBackendCallerAllowed } from "@/lib/sync/backend-auth";
import {
  generateNextInterviewQuestion,
  generateNextInterviewQuestionFallback,
  isVerificationClarificationQuestion
} from "@/lib/creation-ai";
import { parseGenreDimensions, parseInterview, workRevisionWhere } from "@/lib/creation";
import {
  actorOwnsWork,
  checkCreationAiBudget,
  getCreationActor,
  serializeWorkForOwner
} from "@/lib/creation-server";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  answer: z.string().trim().min(1, "回答不能为空").max(8000),
  // 防止旧标签页仍显示上一题，却把答案提交给服务端已经生成的下一题。
  expectedUpdatedAt: z.string().datetime()
});

// 提交当前问题的回答，AI 追问下一题；素材足够或到达题数上限则访谈结束。
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await ensureBackendCallerAllowed(request);
  if (denied) return denied;

  const parsed = await parseJsonBody(request, BodySchema);
  if (!parsed.ok) return parsed.response;

  const work = await prisma.creativeWork.findUnique({ where: { id }, include: { genre: true } });
  if (!work || !actorOwnsWork(work, await getCreationActor())) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  }
  if (work.mode === "MANUAL") {
    return NextResponse.json({ error: "纯手写作品不经访谈，请直接编辑草稿" }, { status: 409 });
  }
  if (work.status !== "INTERVIEWING" || !work.pendingQuestion) {
    return NextResponse.json({ error: "访谈已结束" }, { status: 409 });
  }
  if (work.updatedAt.toISOString() !== parsed.data.expectedUpdatedAt) {
    return NextResponse.json(
      { error: "访谈已在其他页面推进，请刷新后回答当前问题" },
      { status: 409 }
    );
  }

  const interview = parseInterview(work.interview);
  interview.push({ question: work.pendingQuestion, answer: parsed.data.answer });

  // 核验澄清只保存用户补充，不调用模型，因此不应消耗一次 AI 配额。
  if (isVerificationClarificationQuestion(work.pendingQuestion)) {
    const claimed = await prisma.creativeWork.updateMany({
      where: { ...workRevisionWhere(work), pendingQuestion: work.pendingQuestion },
      data: {
        interview: JSON.stringify(interview),
        pendingQuestion: null
      }
    });
    if (claimed.count === 0) {
      return NextResponse.json({ error: "这个问题已经回答过了，请刷新查看最新进度" }, { status: 409 });
    }

    const updated = await prisma.creativeWork.findUniqueOrThrow({ where: { id: work.id }, include: { genre: true } });
    return NextResponse.json({ done: true, work: await serializeWorkForOwner(updated) });
  }

  // 必须先验证作品所有权与状态；未授权请求不能消耗用户或全站 AI 配额。
  const budget = await checkCreationAiBudget(request, "creation-answer", 60);
  if (budget) return budget;

  let next: Awaited<ReturnType<typeof generateNextInterviewQuestion>>;
  let questionFallback = false;
  try {
    next = await generateNextInterviewQuestion({
      genreName: work.genre.name,
      genreDescription: work.genre.description,
      dimensions: parseGenreDimensions(work.genre.dimensions),
      mode: work.mode,
      depth: work.depth,
      topic: work.topic,
      interview
    });
  } catch (error) {
    console.error("[creation-answer] AI call failed:", error);
    next = generateNextInterviewQuestionFallback({
      mode: work.mode,
      depth: work.depth,
      topic: work.topic,
      interview
    });
    questionFallback = true;
  }

  // 乐观并发保护：只在 pendingQuestion 未被其他并发请求消费时写入，
  // 防止双击/重放把同一问题追加两次。
  const claimed = await prisma.creativeWork.updateMany({
    where: { ...workRevisionWhere(work), pendingQuestion: work.pendingQuestion },
    data: {
      interview: JSON.stringify(interview),
      pendingQuestion: next.done ? null : next.question
    }
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "这个问题已经回答过了，请刷新查看最新进度" }, { status: 409 });
  }

  const updated = await prisma.creativeWork.findUniqueOrThrow({ where: { id: work.id }, include: { genre: true } });

  return NextResponse.json({
    done: next.done,
    work: await serializeWorkForOwner(updated),
    questionFallback
  });
}
