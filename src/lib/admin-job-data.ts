import type { JobStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/** List/overview queries never need research inputs, model prompts or article bodies. */
export const ADMIN_JOB_LIST_SELECT = {
  id: true,
  sourceId: true,
  sourceType: true,
  sourceUrl: true,
  status: true,
  error: true,
  contentStyleId: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  source: { select: { name: true, status: true } },
  contentTopic: { select: { name: true } },
  _count: { select: { rawItems: true } }
} satisfies Prisma.FetchJobSelect;

export type AdminJobListEntry = Prisma.FetchJobGetPayload<{ select: typeof ADMIN_JOB_LIST_SELECT }>;
export type AdminJobCount = { status: JobStatus; count: number; failed7d: number };

/** One scan replaces separate status/queued/running/failed counts. No result cache:
 * every authorized page request sees current worker state, using database time.
 */
export async function getAdminJobCounts(): Promise<AdminJobCount[]> {
  return prisma.$queryRaw<AdminJobCount[]>`
    SELECT status, COUNT(*)::int AS count,
      (COUNT(*) FILTER (WHERE status = 'FAILED' AND "updatedAt" >= CURRENT_TIMESTAMP - INTERVAL '7 days'))::int AS "failed7d"
    FROM "FetchJob" GROUP BY status
  `;
}

export function summarizeAdminJobs(rows: AdminJobCount[]) {
  return {
    total: rows.reduce((total, row) => total + row.count, 0),
    running: rows.find((row) => row.status === "RUNNING")?.count || 0,
    queued: rows.find((row) => row.status === "QUEUED")?.count || 0,
    failed7d: rows.reduce((total, row) => total + row.failed7d, 0)
  };
}
