import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseJsonBody } from "@/lib/request-validation";
import { ensureBackendCallerAllowed } from "@/lib/sync/backend-auth";
import { generateNextInterviewQuestion } from "@/lib/creation-ai";
import { parseGenreDimensions, parseInterview } from "@/lib/creation";
import {
  actorOwnsWork,
  checkCreationAiBudget,
  getCreationActor,
  serializeWorkForOwner
} from "@/lib/creation-server";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  answer: z.string().trim().min(1, "回答不能为空").max(8000)
});

// 提交当前问题的回答，AI 追问下一题；素材足够或到达题数上限则访谈结束。
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await ensureBackendCallerAllowed(request);
  if (denied) return denied;

  const budget = await checkCreationAiBudget(request, "creation-answer", 60);
  if (budget) return budget;

  const parsed = await parseJsonBody(request, BodySchema);
  if (!parsed.ok) return parsed.response;

  const work = await prisma.creativeWork.findUnique({ where: { id }, include: { genre: true } });
  if (!work || !actorOwnsWork(work, await getCreationActor())) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  }
  if (work.status !== "INTERVIEWING" || !work.pendingQuestion) {
    return NextResponse.json({ error: "访谈已结束" }, { status: 409 });
  }

  const interview = parseInterview(work.interview);
  interview.push({ question: work.pendingQuestion, answer: parsed.data.answer });

  let next: Awaited<ReturnType<typeof generateNextInterviewQuestion>>;
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
    // 回答还留在用户输入框里（前端成功后才清空），这里失败可安全重试。
    console.error("[creation-answer] AI call failed:", error);
    return NextResponse.json({ error: "AI 暂时无法生成下一个问题，请稍后重试（你的回答不会丢失）" }, { status: 502 });
  }

  // 乐观并发保护：只在 pendingQuestion 未被其他并发请求消费时写入，
  // 防止双击/重放把同一问题追加两次。
  const claimed = await prisma.creativeWork.updateMany({
    where: { id: work.id, pendingQuestion: work.pendingQuestion },
    data: {
      interview: JSON.stringify(interview),
      pendingQuestion: next.done ? null : next.question
    }
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "这个问题已经回答过了，请刷新查看最新进度" }, { status: 409 });
  }

  const updated = await prisma.creativeWork.findUniqueOrThrow({ where: { id: work.id }, include: { genre: true } });

  return NextResponse.json({ done: next.done, work: serializeWorkForOwner(updated) });
}
