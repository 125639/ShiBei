import type { JobStatus } from "@prisma/client";

export const JOB_STATUS_ORDER: JobStatus[] = ["QUEUED", "RUNNING", "COMPLETED", "FAILED"];

export const JOB_STATUS_LABELS: Record<JobStatus, { zh: string; en: string; glyph: string }> = {
  QUEUED: { zh: "排队中", en: "Queued", glyph: "⏳" },
  RUNNING: { zh: "运行中", en: "Running", glyph: "▶" },
  COMPLETED: { zh: "已完成", en: "Completed", glyph: "✓" },
  FAILED: { zh: "已失败", en: "Failed", glyph: "✕" }
};

export function jobStatusClass(status: JobStatus) {
  return `status-pill status-${status.toLowerCase()}`;
}

export function isJobStatus(value: string | null | undefined): value is JobStatus {
  return value != null && (JOB_STATUS_ORDER as readonly string[]).includes(value);
}
