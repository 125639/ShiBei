import { NextResponse } from "next/server";
import type { CreationGenre, CreativeWork } from "@prisma/client";
import { prisma } from "./prisma";
import { checkGlobalRateLimit, checkRateLimit } from "./rate-limit";
import { ensureAnonId, getAnonId, getMemberSession } from "./member-auth";
import {
  ANON_WORK_LIMIT,
  CREATION_DEPTHS,
  parseGenreDimensions,
  parseInterview,
  type ScoreDetail
} from "./creation";

// ============ 共创工作室：仅服务端（Route Handler）使用的辅助 ============

export type CreationActor = { memberId: string | null; anonId: string | null };

/** 读取当前请求者身份（不创建匿名 cookie）。 */
export async function getCreationActor(): Promise<CreationActor> {
  const session = await getMemberSession();
  return {
    memberId: session?.memberId ?? null,
    anonId: await getAnonId()
  };
}

/** 开始创作时使用：未登录则签发匿名身份 cookie。 */
export async function getOrCreateCreationActor(): Promise<CreationActor> {
  const session = await getMemberSession();
  if (session) return { memberId: session.memberId, anonId: await getAnonId() };
  return { memberId: null, anonId: await ensureAnonId() };
}

/**
 * 所有权：归属账号的作品只认账号；未归属账号的匿名作品认匿名 cookie。
 * 匿名作品被注册用户认领（claimAnonWorks）后即只认账号。
 */
export function actorOwnsWork(
  work: Pick<CreativeWork, "ownerId" | "anonId">,
  actor: CreationActor
): boolean {
  if (work.ownerId) return actor.memberId === work.ownerId;
  return Boolean(work.anonId && actor.anonId && work.anonId === actor.anonId);
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

/**
 * 未登录生成配额：按「已成稿」的匿名作品数计，单 IP 最多 ANON_WORK_LIMIT 篇。
 * 用数据库持久计数而不是限流器——重启和时间窗都不该重置这个配额。
 */
export async function countAnonGeneratedWorks(clientIp: string) {
  return prisma.creativeWork.count({
    where: { ownerId: null, clientIp, draftGeneratedAt: { not: null } }
  });
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

/** 给作品所有者的完整视图（不含 clientIp / anonId 等内部字段）。 */
export function serializeWorkForOwner(work: CreativeWork & { genre: CreationGenre }) {
  const config = CREATION_DEPTHS[work.depth];
  let scoreDetail: ScoreDetail | null = null;
  if (work.scoreDetail) {
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
    score: work.score,
    scoreDetail,
    scoredAt: work.scoredAt,
    publishedAt: work.publishedAt,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt
  };
}
