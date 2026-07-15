import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseJsonBody } from "@/lib/request-validation";
import { AnonymousBootstrapRequiredError } from "@/lib/member-auth";
import {
  ListPaginationError,
  descendingUpdatedAtCursorWhere,
  finishDescendingUpdatedAtPage,
  identityBoundListScope,
  parseListPageRequest
} from "@/lib/list-pagination";
import { ensureBackendCallerAllowed } from "@/lib/sync/backend-auth";
import {
  generateNextInterviewQuestion,
  generateNextInterviewQuestionFallback
} from "@/lib/creation-ai";
import {
  ANON_WORK_LIMIT,
  ownerScorePresentation,
  parseGenreDimensions
} from "@/lib/creation";
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

  const parsed = await parseJsonBody(request, StartSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const genre = await prisma.creationGenre.findUnique({ where: { id: body.genreId } });
  if (!genre || !genre.isEnabled) {
    return NextResponse.json({ error: "题材不存在或已停用" }, { status: 404 });
  }

  let actor: Awaited<ReturnType<typeof getOrCreateCreationActor>>;
  try {
    actor = await getOrCreateCreationActor(request);
  } catch (error) {
    if (error instanceof AnonymousBootstrapRequiredError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  const clientIp = getClientIp(request);

  // 未登录配额在「成稿」时才真正扣减，这里提前拦住已经用完的 IP，
  // 避免访谈完成后才发现无法生成。
  if (!actor.memberId && (await anonQuotaRemaining(clientIp)) <= 0) {
    return NextResponse.json(
      { error: `未登录状态下单个 IP 最多生成 ${ANON_WORK_LIMIT} 篇文章。登录后新建的作品不受此匿名额度限制，并由该账号独立管理。当前匿名作品不会自动转入账号。` },
      { status: 403 }
    );
  }

  // 只让已经通过输入、题材和匿名配额校验的请求占用 AI 预算。
  const budget = await checkCreationAiBudget(request, "creation-start", 10);
  if (budget) return budget;

  let first: Awaited<ReturnType<typeof generateNextInterviewQuestion>>;
  let questionFallback = false;
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
    first = generateNextInterviewQuestionFallback({
      mode: body.mode,
      depth: body.depth,
      topic: body.topic,
      interview: []
    });
    questionFallback = true;
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

  return NextResponse.json({ work: await serializeWorkForOwner(work), questionFallback });
}

// 我的作品列表（登录用户按账号，未登录按匿名身份 cookie）。
export async function GET(request: Request) {
  const actor = await getCreationActor();
  const cursorScope = identityBoundListScope("creation-works", actor);
  let pagination;
  try {
    pagination = parseListPageRequest(request.url, {
      scope: cursorScope,
      defaultPageSize: 50,
      maxPageSize: 100
    });
  } catch (error) {
    if (error instanceof ListPaginationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const where = actor.memberId
    ? { ownerId: actor.memberId }
    : actor.anonId
      ? { ownerId: null, anonId: actor.anonId }
      : null;

  const workRows = where
    ? await prisma.creativeWork.findMany({
        where: {
          ...where,
          ...descendingUpdatedAtCursorWhere(pagination.cursor)
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: pagination.pageSize + 1,
        select: {
          id: true,
          slug: true,
          status: true,
          mode: true,
          depth: true,
          topic: true,
          title: true,
          summary: true,
          content: true,
          score: true,
          scoredHash: true,
          scoredRubricHash: true,
          publishedAt: true,
          publishedOnceAt: true,
          updatedAt: true,
          genre: {
            select: {
              name: true,
              dimensions: true,
              threshold: true
            }
          }
        }
      })
    : [];
  const page = finishDescendingUpdatedAtPage(cursorScope, workRows, pagination.pageSize);
  const works = page.items.map((work) => {
    const scorePresentation = ownerScorePresentation(work);
    return {
      id: work.id,
      slug: work.slug,
      status: work.status,
      mode: work.mode,
      depth: work.depth,
      topic: work.topic,
      title: work.title,
      score: scorePresentation.score,
      scoreCurrent: scorePresentation.current,
      hasHistoricalScore: scorePresentation.hasHistoricalScore,
      publishedAt: work.publishedAt,
      // Keep the account UI aligned with the irreversible server policy. An
      // administrator unpublish changes status back to DRAFT, but must never
      // make a formerly public anonymous work look deletable again.
      canDelete: Boolean(actor.memberId)
        || (work.status !== "SHARED" && work.publishedOnceAt === null),
      updatedAt: work.updatedAt,
      genre: { name: work.genre.name, threshold: work.genre.threshold }
    };
  });

  return NextResponse.json({
    works,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    isMember: Boolean(actor.memberId),
    anonQuotaRemaining: actor.memberId ? null : await anonQuotaRemaining(getClientIp(request)),
    anonWorkLimit: ANON_WORK_LIMIT
  });
}
