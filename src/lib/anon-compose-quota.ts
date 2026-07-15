import { prisma } from "./prisma";
import { ANON_WORK_LIMIT } from "./creation";

// 远长于正常模型请求超时；只有进程崩溃、容器被强杀等没有 finally 的情况
// 才会由后续请求回收，避免永久吃掉匿名用户的名额。
export const ANON_COMPOSE_RESERVATION_TTL_MS = 30 * 60 * 1000;

export type AnonymousComposeReservationFailure = "quota" | "in_progress" | "changed";

export class AnonymousComposeReservationError extends Error {
  constructor(readonly reason: AnonymousComposeReservationFailure) {
    super(
      reason === "quota"
        ? "匿名成稿配额已用完"
        : reason === "in_progress"
          ? "这篇作品正在成稿"
          : "作品状态刚刚发生变化"
    );
    this.name = "AnonymousComposeReservationError";
  }
}

/**
 * 为匿名作品原子预留一个首次 AI 成稿名额。
 *
 * PostgreSQL advisory lock 按 clientIp 串行化「清理过期预留 → 计数 → 占位」。
 * 占位和释放使用原生 UPDATE，刻意不改 Prisma 的 updatedAt：compose/score/publish
 * 的乐观版本条件只应反映用户可见作品变化，不能被内部租约制造伪冲突。
 */
export async function reserveAnonymousComposeSlot(input: {
  workId: string;
  clientIp: string;
  now?: Date;
}): Promise<Date | null> {
  const now = input.now ?? new Date();
  const staleBefore = new Date(now.getTime() - ANON_COMPOSE_RESERVATION_TTL_MS);

  return prisma.$transaction(async (tx) => {
    const lockKey = `shibei:anon-compose:${input.clientIp}`;
    // pg_advisory_xact_lock returns PostgreSQL `void`, which Prisma cannot
    // deserialize as a selected column. Execute it inside a derived table and
    // expose only a supported integer sentinel to the client.
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM (
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
      ) AS "advisory_lock"
    `;

    await tx.$executeRaw`
      UPDATE "CreativeWork"
      SET "composeReservedAt" = NULL
      WHERE "ownerId" IS NULL
        AND "clientIp" = ${input.clientIp}
        AND "draftGeneratedAt" IS NULL
        AND "composeReservedAt" < ${staleBefore}
    `;

    const work = await tx.creativeWork.findUnique({
      where: { id: input.workId },
      select: {
        ownerId: true,
        clientIp: true,
        draftGeneratedAt: true,
        composeReservedAt: true
      }
    });
    if (!work || work.clientIp !== input.clientIp) {
      throw new AnonymousComposeReservationError("changed");
    }
    // 登录作品和已经首次成稿的作品不占匿名首次成稿名额。
    if (work.ownerId || work.draftGeneratedAt) return null;
    if (work.composeReservedAt) {
      throw new AnonymousComposeReservationError("in_progress");
    }

    const used = await tx.anonymousComposeUsage.count({
      where: { clientIp: input.clientIp }
    });
    const reserved = await tx.creativeWork.count({
      where: {
        ownerId: null,
        clientIp: input.clientIp,
        draftGeneratedAt: null,
        composeReservedAt: { not: null }
      }
    });
    if (used + reserved >= ANON_WORK_LIMIT) {
      throw new AnonymousComposeReservationError("quota");
    }

    const claimed = await tx.$executeRaw`
      UPDATE "CreativeWork"
      SET "composeReservedAt" = ${now}
      WHERE "id" = ${input.workId}
        AND "ownerId" IS NULL
        AND "clientIp" = ${input.clientIp}
        AND "draftGeneratedAt" IS NULL
        AND "composeReservedAt" IS NULL
    `;
    if (claimed !== 1) throw new AnonymousComposeReservationError("changed");
    return now;
  });
}

/** 只释放本请求持有的那一版租约，旧请求不能误清后来请求的新租约。 */
export async function releaseAnonymousComposeSlot(workId: string, reservation: Date | null) {
  if (!reservation) return;
  await prisma.$executeRaw`
    UPDATE "CreativeWork"
    SET "composeReservedAt" = NULL
    WHERE "id" = ${workId}
      AND "composeReservedAt" = ${reservation}
  `;
}
