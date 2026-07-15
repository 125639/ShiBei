import { NextResponse } from "next/server";
import type { CreationGenre, CreativeWork } from "@prisma/client";
import { prisma } from "./prisma";
import { checkGlobalRateLimit, checkRateLimit } from "./rate-limit";
import { ensureAnonIdForCreationRequest, getAnonId, getMemberSession } from "./member-auth";
import { trustedClientIp } from "./client-ip";
import {
  ANON_WORK_LIMIT,
  CREATION_DEPTHS,
  isScoredRubricCurrent,
  legacyWorkScoreFingerprint,
  ownerScorePresentation,
  parseGenreDimensions,
  parseInterview,
  workScoreFingerprint,
  type ScoreDetail
} from "./creation";

// ============ 共创工作室：仅服务端（Route Handler）使用的辅助 ============

export type CreationActor = { memberId: string | null; anonId: string | null };

/** 读取当前请求者身份（不创建匿名 cookie）。 */
export async function getCreationActor(): Promise<CreationActor> {
  const session = await getMemberSession();
  // 账号身份与匿名身份互斥。即使请求同时携带两种 cookie，登录态也绝不能
  // 回退到 anonId，否则共享浏览器上的后一个登录用户可操作前一个匿名用户的作品。
  if (session) return { memberId: session.memberId, anonId: null };
  return {
    memberId: null,
    anonId: await getAnonId()
  };
}

/** 开始创作时使用：未登录则签发匿名身份 cookie。 */
export async function getOrCreateCreationActor(request: Request): Promise<CreationActor> {
  const session = await getMemberSession();
  if (session) return { memberId: session.memberId, anonId: null };
  return { memberId: null, anonId: await ensureAnonIdForCreationRequest(request) };
}

/**
 * 所有权：身份严格二选一。登录请求只认 memberId，绝不同时使用 anonId；
 * 未登录请求才可凭匿名 cookie 访问匿名作品。
 */
export function actorOwnsWork(
  work: Pick<CreativeWork, "ownerId" | "anonId">,
  actor: CreationActor
): boolean {
  if (actor.memberId) return work.ownerId === actor.memberId;
  if (actor.anonId) return work.ownerId === null && work.anonId === actor.anonId;
  return false;
}

export function getClientIp(request: Request): string {
  return trustedClientIp(request);
}

/**
 * 未登录生成配额：按「已成稿」的匿名作品数计，单 IP 最多 ANON_WORK_LIMIT 篇。
 * 用数据库持久计数而不是限流器——重启和时间窗都不该重置这个配额。
 */
export async function countAnonGeneratedWorks(clientIp: string) {
  // 用不可随作品删除的生成事件计数。否则“成稿→复制→删草稿”会无限恢复额度。
  return prisma.anonymousComposeUsage.count({ where: { clientIp } });
}

export async function anonQuotaRemaining(clientIp: string) {
  const used = await countAnonGeneratedWorks(clientIp);
  return Math.max(0, ANON_WORK_LIMIT - used);
}

/**
 * 共创 AI 调用的统一预算闸门：per-IP 限流 + 全局每日额度（AI_CREATION_DAILY_LIMIT）。
 * 返回 null 表示放行，否则返回应直接回复的 429。
 */
export async function checkCreationAiBudget(
  request: Request,
  namespace: string,
  limitPerHour: number
): Promise<NextResponse | null> {
  const limited = await checkRateLimit({
    namespace,
    request,
    limit: limitPerHour,
    windowSec: 60 * 60
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
  }

  const daily = Number(process.env.AI_CREATION_DAILY_LIMIT);
  const dailyLimit = Number.isFinite(daily) && daily > 0 ? Math.floor(daily) : 300;
  const globalLimited = await checkGlobalRateLimit({
    namespace: "creation",
    limit: dailyLimit,
    windowSec: 24 * 60 * 60
  });
  if (!globalLimited.ok) {
    return NextResponse.json(
      { error: "今日共创 AI 额度已用完，请明天再来" },
      { status: 429, headers: { "Retry-After": String(globalLimited.retryAfterSec) } }
    );
  }
  return null;
}

export function serializeGenre(genre: CreationGenre) {
  return {
    id: genre.id,
    slug: genre.slug,
    name: genre.name,
    description: genre.description,
    dimensions: parseGenreDimensions(genre.dimensions),
    threshold: genre.threshold
  };
}

/**
 * 只查询当前公开表面是否命中一条历史治理记录。不会读取或返回其他历史原因，
 * 因而所有者响应既能正确阻止 A→B→A，也不会泄露无关的治理历史。
 */
export async function findCurrentModeratedSurface(
  work: Pick<CreativeWork, "id" | "title" | "summary" | "content">
) {
  return prisma.communityModeratedSurface.findFirst({
    where: {
      workId: work.id,
      OR: [
        {
          algorithm: "TITLE_SUMMARY_CONTENT_V2",
          surfaceHash: workScoreFingerprint(work)
        },
        {
          algorithm: "TITLE_CONTENT_V1",
          surfaceHash: legacyWorkScoreFingerprint(work)
        }
      ]
    },
    orderBy: { createdAt: "desc" },
    select: { algorithm: true, surfaceHash: true, reason: true }
  });
}

/** 给作品所有者的完整视图（不含 clientIp / anonId 等内部字段）。 */
export async function serializeWorkForOwner(
  work: CreativeWork & { genre: CreationGenre },
  knownModeratedSurface?: Awaited<ReturnType<typeof findCurrentModeratedSurface>>
) {
  const config = CREATION_DEPTHS[work.depth];
  const moderatedSurface = knownModeratedSurface === undefined
    ? await findCurrentModeratedSurface(work)
    : knownModeratedSurface;
  const scorePresentation = ownerScorePresentation(work);
  let scoreDetail: ScoreDetail | null = null;
  if (scorePresentation.current && work.scoreDetail) {
    try {
      scoreDetail = JSON.parse(work.scoreDetail) as ScoreDetail;
    } catch {
      scoreDetail = null;
    }
  }
  return {
    id: work.id,
    slug: work.slug,
    status: work.status,
    mode: work.mode,
    depth: work.depth,
    topic: work.topic,
    title: work.title,
    summary: work.summary,
    content: work.content,
    interview: parseInterview(work.interview),
    pendingQuestion: work.pendingQuestion,
    minQuestions: config.minQuestions,
    maxQuestions: config.maxQuestions,
    genre: serializeGenre(work.genre),
    isAnonymous: !work.ownerId,
    draftGeneratedAt: work.draftGeneratedAt,
    score: scorePresentation.score,
    scoreDetail,
    scoredAt: scorePresentation.current ? work.scoredAt : null,
    scoreCurrent: scorePresentation.current,
    hasHistoricalScore: scorePresentation.hasHistoricalScore,
    scoreRubricCurrent: isScoredRubricCurrent(work),
    moderationReason: moderatedSurface?.reason ?? null,
    moderationBlocked: Boolean(moderatedSurface),
    publishedAt: work.publishedAt,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt
  };
}
