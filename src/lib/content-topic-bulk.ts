import { prisma } from "./prisma";
import { enqueueTopicRun } from "./auto-curation";
import { removeScheduleByTopicId, syncSchedule } from "./scheduler";

export function parseBulkTopicIds(formData: FormData): string[] {
  return Array.from(new Set(formData.getAll("ids").map(String).filter(Boolean)));
}

export async function setTopicsEnabled(ids: string[], isEnabled: boolean) {
  if (!ids.length) return;
  await prisma.contentTopic.updateMany({ where: { id: { in: ids } }, data: { isEnabled } });
  const schedules = await prisma.autoSchedule.findMany({ where: { topicId: { in: ids } } });
  await prisma.autoSchedule.updateMany({ where: { topicId: { in: ids } }, data: { isEnabled } });
  for (const schedule of schedules) {
    await syncSchedule(schedule.id);
  }
}

export async function runTopics(ids: string[]) {
  const result = { enqueued: 0, skipped: 0 };
  for (const id of ids) {
    const topicRun = await enqueueTopicRun(id);
    result.enqueued += topicRun.enqueued;
    result.skipped += topicRun.skipped;
  }
  return result;
}

export async function deleteTopics(ids: string[]) {
  for (const id of ids) {
    await removeScheduleByTopicId(id);
    await prisma.contentTopic.delete({ where: { id } }).catch((error: unknown) => {
      // ContentTopic 关联 fetchJobs（FK Restrict），有历史任务的删除会抛
      // P2003。静默吞掉的后果：调度器已被先删、主题却还在——从此不再自动
      // 运行也无任何报错。至少要留痕。
      console.error(`[content-topic] 删除主题失败 id=${id}（注意:其调度器已被移除）:`, error);
    });
  }
}
