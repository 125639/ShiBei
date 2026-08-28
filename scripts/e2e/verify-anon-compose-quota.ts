/**
 * PostgreSQL integration check for the anonymous compose reservation.
 * Run after migrations with a disposable/test DATABASE_URL:
 *   npx tsx scripts/e2e/verify-anon-compose-quota.ts
 */
import assert from "node:assert/strict";
import {
  ANON_COMPOSE_RESERVATION_TTL_MS,
  AnonymousComposeReservationError,
  releaseAnonymousComposeSlot,
  reserveAnonymousComposeSlot
} from "../../src/lib/anon-compose-quota";
import { prisma } from "../../src/lib/prisma";

const runId = `quota-e2e-${Date.now()}`;
const firstIp = `198.51.100.${Math.floor(Math.random() * 100) + 1}`;
const secondIp = `203.0.113.${Math.floor(Math.random() * 100) + 1}`;
const staleLeaseIp = `192.0.2.${Math.floor(Math.random() * 100) + 1}`;
const workIds: string[] = [];

function pass(label: string) {
  console.log(`PASS  ${label}`);
}

async function main() {
try {
  const genre = await prisma.creationGenre.findFirst({ where: { isEnabled: true } });
  assert.ok(genre, "测试库至少需要一个启用的题材（先运行 db:seed）");

  for (let index = 0; index < 9; index += 1) {
    const work = await prisma.creativeWork.create({
      data: {
        ownerId: null,
        anonId: `${runId}-anon-${index}`,
        clientIp: index === 6 ? secondIp : index >= 7 ? staleLeaseIp : firstIp,
        genreId: genre.id,
        mode: "AI_FIRST",
        depth: "SHORT",
        topic: `${runId}-${index}`
      }
    });
    workIds.push(work.id);
  }

  const concurrent = await Promise.allSettled(
    workIds.slice(0, 5).map((workId) => reserveAnonymousComposeSlot({ workId, clientIp: firstIp }))
  );
  const granted = concurrent.flatMap((result, index) =>
    result.status === "fulfilled" && result.value
      ? [{ workId: workIds[index], reservation: result.value }]
      : []
  );
  const denied = concurrent.filter((result) =>
    result.status === "rejected" &&
    result.reason instanceof AnonymousComposeReservationError &&
    result.reason.reason === "quota"
  );
  assert.equal(granted.length, 2, "五个并发首次成稿只能原子获批两个");
  assert.equal(denied.length, 3);
  pass("同 IP 五个并发请求严格限制为两个预留");

  // 模拟 compose 路由的成功事务：可见草稿和不可删除的额度账本同成同败。
  for (const item of granted) {
    await prisma.$transaction(async (tx) => {
      const generatedAt = new Date();
      await tx.creativeWork.update({
        where: { id: item.workId },
        data: { draftGeneratedAt: generatedAt, composeReservedAt: null, status: "DRAFT" }
      });
      await tx.anonymousComposeUsage.create({
        data: { clientIp: firstIp, workId: item.workId, createdAt: generatedAt }
      });
    });
    await releaseAnonymousComposeSlot(item.workId, item.reservation);
  }
  await assert.rejects(
    reserveAnonymousComposeSlot({ workId: workIds[5], clientIp: firstIp }),
    (error) => error instanceof AnonymousComposeReservationError && error.reason === "quota"
  );
  pass("成功成稿后名额持久计数，释放租约也不能重置额度");

  // 删除作品只能删除作品本身，不能抹掉已实际消费的匿名模型额度。
  await prisma.creativeWork.delete({ where: { id: granted[0].workId } });
  assert.equal(
    await prisma.anonymousComposeUsage.count({ where: { clientIp: firstIp } }),
    2,
    "匿名额度账本必须独立于可删除的作品"
  );
  await assert.rejects(
    reserveAnonymousComposeSlot({ workId: workIds[5], clientIp: firstIp }),
    (error) => error instanceof AnonymousComposeReservationError && error.reason === "quota"
  );
  pass("删除匿名草稿后额度仍不会恢复，无法靠反复删除绕过上限");

  const otherIpReservation = await reserveAnonymousComposeSlot({ workId: workIds[6], clientIp: secondIp });
  assert.ok(otherIpReservation);
  await releaseAnonymousComposeSlot(workIds[6], otherIpReservation);
  pass("不同 IP 的匿名配额互不污染");

  // 独立 IP 模拟进程崩溃留下的过期租约，避免永久账本干扰租约回收断言。
  const staleWorkId = workIds[7];
  const staleReservation = await reserveAnonymousComposeSlot({
    workId: staleWorkId,
    clientIp: staleLeaseIp,
    now: new Date(Date.now() - ANON_COMPOSE_RESERVATION_TTL_MS - 1_000)
  });
  assert.ok(staleReservation);
  const reclaimed = await reserveAnonymousComposeSlot({ workId: workIds[8], clientIp: staleLeaseIp });
  assert.ok(reclaimed);
  assert.equal((await prisma.creativeWork.findUniqueOrThrow({ where: { id: staleWorkId } })).composeReservedAt, null);
  await releaseAnonymousComposeSlot(workIds[8], reclaimed);
  pass("进程崩溃遗留的过期租约会被安全回收");

  console.log("\nAll anonymous compose quota integration checks passed.");
} finally {
  await prisma.anonymousComposeUsage.deleteMany({ where: { workId: { in: workIds } } }).catch(() => undefined);
  await prisma.creativeWork.deleteMany({ where: { id: { in: workIds } } }).catch(() => undefined);
  await prisma.$disconnect();
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
