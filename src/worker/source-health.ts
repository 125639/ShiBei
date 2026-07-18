import { prisma } from "../lib/prisma";

// 连续失败达到此阈值即自动 PAUSED；成功一次清零。
export const SOURCE_FAIL_PAUSE_THRESHOLD = 5;

// 来源健康记账绝不能影响主流程：内部整体 try/catch，永不抛。
// sourceId 为空（临时抓取、关键词研究等无来源任务）直接跳过。
export async function recordSourceFailure(sourceId: string | null | undefined) {
  if (!sourceId) return;
  try {
    const updated = await prisma.source.update({
      where: { id: sourceId },
      data: { failStreak: { increment: 1 } },
      select: { failStreak: true, status: true }
    });
    if (updated.failStreak >= SOURCE_FAIL_PAUSE_THRESHOLD && updated.status !== "PAUSED") {
      await prisma.source.update({ where: { id: sourceId }, data: { status: "PAUSED" } });
      console.warn(`[source-health] 来源 ${sourceId} 连续失败 ${updated.failStreak} 次（阈值 ${SOURCE_FAIL_PAUSE_THRESHOLD}），已自动暂停（PAUSED）。`);
    }
  } catch (error) {
    console.error("[source-health] recordSourceFailure 失败:", error);
  }
}

export async function recordSourceSuccess(sourceId: string | null | undefined) {
  if (!sourceId) return;
  try {
    // 仅在当前有累计失败时才写库，避免每次成功都白白 UPDATE。
    const source = await prisma.source.findUnique({ where: { id: sourceId }, select: { failStreak: true } });
    if (source && source.failStreak > 0) {
      await prisma.source.update({ where: { id: sourceId }, data: { failStreak: 0 } });
    }
  } catch (error) {
    console.error("[source-health] recordSourceSuccess 失败:", error);
  }
}
