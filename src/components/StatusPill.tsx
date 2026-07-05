import { JOB_STATUS_LABELS, jobStatusClass } from "@/lib/job-status";
import type { JobStatus } from "@prisma/client";
import { I18nText } from "./I18nText";

export function StatusPill({ status }: { status: JobStatus }) {
  const info = JOB_STATUS_LABELS[status];
  return (
    <span className={jobStatusClass(status)}>
      <span aria-hidden="true" className="status-glyph">{info.glyph}</span>
      <I18nText zh={info.zh} en={info.en} />
    </span>
  );
}
