"use client";

import type { JobStatus } from "@prisma/client";
import { AdminLink as Link } from "./admin/AdminLink";
import { I18nText } from "./I18nTextClient";

/** Keep the stored failure visible without confusing a queued retry with a final failure. */
export function AdminAiJobDiagnostic({ job }: {
  job: { id: string; status: JobStatus; error: string | null };
}) {
  const message = job.error?.trim();
  if (job.status !== "FAILED" && !(job.status === "QUEUED" && message)) return null;

  return (
    <p className="admin-ai-job-diagnostic muted">
      <I18nText
        zh={job.status === "FAILED" ? "失败原因：" : "重试信息："}
        en={job.status === "FAILED" ? "Failure reason: " : "Retry information: "}
      />
      {message || <I18nText zh="未记录错误，请检查 Worker 日志。" en="No error was recorded. Check the Worker logs." />}
      {" "}
      <Link className="text-link" href={`/admin/jobs/${job.id}`}>
        <I18nText zh="查看完整详情" en="View full details" />
      </Link>
    </p>
  );
}
