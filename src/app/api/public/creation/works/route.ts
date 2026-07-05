import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseJsonBody } from "@/lib/request-validation";
import { ensureBackendCallerAllowed } from "@/lib/sync/backend-auth";
import { generateNextInterviewQuestion } from "@/lib/creation-ai";
import { ANON_WORK_LIMIT, parseGenreDimensions } from "@/lib/creation";
import {
  anonQuotaRemaining,
  checkCreationAiBudget,
  getClientIp,
  getCreationActor,
  getOrCreateCreationActor,
  serializeWorkForOwner
} from "@/lib/creation-server";

export const dynamic = "force-dynamic";

const StartSchema = z.object({
  genreId: z.string().min(1),
  mode: z.enum(["VOICE_FIRST", "AI_FIRST"]),
  depth: z.enum(["SHORT", "FULL"]),
  topic: z.string().trim().min(2, "请用一句话说明想写什么").max(300)
});

// 开始一次共创访谈。作品默认私有，只有创作者主动发布才会公开。
export async function POST(request: Request) {
  const denied = await ensureBackendCallerAllowed(request);
  if (denied) return denied;

  const budget = await checkCreationAiBudget(request, "creation-start", 10);
  if (budget) return budget;

  const parsed = await parseJsonBody(request, StartSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const genre = await prisma.creationGenre.findUnique({ where: { id: body.genreId } });
  if (!genre || !genre.isEnabled) {
    return NextResponse.json({ error: "题材不存在或已停用" }, { status: 404 });
  }

  const actor = await getOrCreateCreationActor();
  const clientIp = getClientIp(request);

  // 未登录配额在「成稿」时才真正扣减，这里提前拦住已经用完的 IP，
  // 避免访谈完成后才发现无法生成。
  if (!actor.memberId && (await anonQuotaRemaining(clientIp)) <= 0) {
    return NextResponse.json(
      { error: `未登录状态下单个 IP 最多生成 ${ANON_WORK_LIMIT} 篇文章。注册账号后可继续创作，并获得对作品的完整管理权。` },
      { status: 403 }
    );
  }

  let first: Awaited<ReturnType<typeof generateNextInterviewQuestion>>;
  try {
    first = await generateNextInterviewQuestion({
      genreName: genre.name,
      genreDescription: genre.description,
      dimensions: parseGenreDimensions(genre.dimensions),
      mode: body.mode,
      depth: body.depth,
      topic: body.topic,
      interview: []
    });
  } catch (error) {
    console.error("[creation-start] AI call failed:", error);
    return NextResponse.json({ error: "AI 暂时无法开始访谈，请稍后重试" }, { status: 502 });
  }
  if (first.done) {
    return NextResponse.json({ error: "生成首个访谈问题失败，请重试" }, { status: 502 });
  }

  const work = await prisma.creativeWork.create({
    data: {
      ownerId: actor.memberId,
      anonId: actor.memberId ? null : actor.anonId,
      clientIp,
      genreId: genre.id,
      mode: body.mode,
      depth: body.depth,
      topic: body.topic,
      pendingQuestion: first.question
    },
    include: { genre: true }
  });

  return NextResponse.json({ work: serializeWorkForOwner(work) });
}

// 我的作品列表（登录用户按账号，未登录按匿名身份 cookie）。
export async function GET(request: Request) {
  const actor = await getCreationActor();
  const where = actor.memberId
    ? { ownerId: actor.memberId }
    : actor.anonId
      ? { ownerId: null, anonId: actor.anonId }
      : null;

  const works = where
    ? await prisma.creativeWork.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: {
          id: true,
          slug: true,
          status: true,
          mode: true,
          depth: true,
          topic: true,
          title: true,
          score: true,
          publishedAt: true,
          updatedAt: true,
          genre: { select: { name: true, threshold: true } }
        }
      })
    : [];

  return NextResponse.json({
    works,
    isMember: Boolean(actor.memberId),
    anonQuotaRemaining: actor.memberId ? null : await anonQuotaRemaining(getClientIp(request)),
    anonWorkLimit: ANON_WORK_LIMIT
  });
}
