import type { Queue } from "bullmq";
import { prisma } from "./prisma";
import { getScheduleQueue } from "./queue";

/**
 * BullMQ repeatable job manager for AutoSchedule rows.
 *
 * Uses upsertJobScheduler / removeJobScheduler (BullMQ v5+) so we get a stable
 * jobSchedulerId we can compute from topicId. That way we never have to remember
 * BullMQ-internal repeat keys across restarts.
 */

export const SCHEDULE_JOB_NAME = "topic-tick";

export function buildScheduleId(topicId: string) {
  return `topic:${topicId}`;
}

async function withQueue<T>(fn: (queue: Queue) => Promise<T>): Promise<T> {
  const queue = getScheduleQueue();
  try {
    return await fn(queue);
  } finally {
    await queue.close();
  }
}

export async function syncSchedule(scheduleId: string) {
  const schedule = await prisma.autoSchedule.findUnique({
    where: { id: scheduleId },
    include: { topic: true }
  });
  if (!schedule) return;

  const id = buildScheduleId(schedule.topicId);

  await withQueue(async (queue) => {
    // Remove any existing scheduler so we always pick up the latest cron.
    await queue.removeJobScheduler(id).catch(() => undefined);

    if (!schedule.isEnabled || !schedule.topic.isEnabled) {
      await prisma.autoSchedule.update({
        where: { id: schedule.id },
        data: { bullJobKey: null, nextRunAt: null }
      });
      return;
    }

    await queue.upsertJobScheduler(
      id,
      { pattern: schedule.cron },
      {
        name: SCHEDULE_JOB_NAME,
        data: { topicId: schedule.topicId },
        opts: {
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 50 }
        }
      }
    );

    await prisma.autoSchedule.update({
      where: { id: schedule.id },
      data: { bullJobKey: id }
    });
  });
}

export async function removeScheduleByTopicId(topicId: string) {
  const id = buildScheduleId(topicId);
  await withQueue(async (queue) => {
    await queue.removeJobScheduler(id).catch(() => undefined);
  });
}

export async function bootstrapAllSchedules() {
  const schedules = await prisma.autoSchedule.findMany({ include: { topic: true } });
  await withQueue(async (queue) => {
    for (const schedule of schedules) {
      const id = buildScheduleId(schedule.topicId);
      await queue.removeJobScheduler(id).catch(() => undefined);

      if (!schedule.isEnabled || !schedule.topic.isEnabled) continue;

      try {
        await queue.upsertJobScheduler(
          id,
          { pattern: schedule.cron },
          {
            name: SCHEDULE_JOB_NAME,
            data: { topicId: schedule.topicId },
            opts: {
              removeOnComplete: { count: 50 },
              removeOnFail: { count: 50 }
            }
          }
        );
        await prisma.autoSchedule.update({
          where: { id: schedule.id },
          data: { bullJobKey: id }
        });
      } catch (error) {
        console.error(`Failed to bootstrap schedule for topic ${schedule.topicId}:`, error);
      }
    }
  });
}
