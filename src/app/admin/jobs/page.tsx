import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AdminShell } from "@/components/AdminShell";
import { AutoRefresh } from "@/components/AutoRefresh";
import { I18nText } from "@/components/I18nText";
import { MetricCard } from "@/components/MetricCard";
import { StatusPill } from "@/components/StatusPill";
import { SubmitButton } from "@/components/SubmitButton";
import { TaskProgress } from "@/components/TaskProgress";
import { requireAdmin } from "@/lib/auth";
import { JOB_STATUS_LABELS, JOB_STATUS_ORDER, isJobStatus } from "@/lib/job-status";
import { formatDateTime, getJobDuration, getJobKindLabel, getJobTitleLabel } from "@/lib/job-utils";
import { decodePostRepairResult, parsePostRepairUrl } from "@/lib/post-repair";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function getSevenDayWindowStart() {
  const [row] = await prisma.$queryRaw<Array<{ since: Date }>>`
    SELECT CURRENT_TIMESTAMP - INTERVAL '7 days' AS "since"
  `;
  return row.since;
}

export default async function AdminJobsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const rawStatus = typeof params.status === "string" ? params.status : null;
  const status = isJobStatus(rawStatus) ? rawStatus : null;
  const sourceId = typeof params.sourceId === "string" ? params.sourceId : null;
  const where: Prisma.FetchJobWhereInput = {
    ...(status ? { status } : {}),
    ...(sourceId ? { sourceId } : {})
  };
  const since = await getSevenDayWindowStart();

  const [jobs, statusSummary, recentFailed, running, queued, source] = await Promise.all([
    prisma.fetchJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 80,
      include: {
        source: { select: { id: true, name: true, url: true, status: true } },
        contentTopic: { select: { id: true, name: true, slug: true } },
        _count: { select: { rawItems: true } }
      }
    }),
    prisma.fetchJob.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.fetchJob.count({ where: { status: "FAILED", updatedAt: { gte: since } } }),
    prisma.fetchJob.count({ where: { status: "RUNNING" } }),
    prisma.fetchJob.count({ where: { status: "QUEUED" } }),
    sourceId ? prisma.source.findUnique({ where: { id: sourceId }, select: { name: true, url: true } }) : null
  ]);

  const totalByStatus = new Map(statusSummary.map((item) => [item.status, item._count._all]));

  return (
    <AdminShell>
      <AutoRefresh active={running > 0 || queued > 0} />
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">Jobs</p>
          <h1><I18nText zh="任务诊断" en="Job Diagnostics" /></h1>
          {source ? (
            <p className="muted">
              <I18nText zh="当前只看来源：" en="Filtered by source: " /><strong>{source.name}</strong> · {source.url}
            </p>
          ) : null}
        </div>
        <div className="admin-page-actions">
          <Link className="button secondary" href="/admin"><I18nText zh="返回仪表盘" en="Back to Dashboard" /></Link>
          {sourceId ? <Link className="button secondary" href="/admin/jobs"><I18nText zh="清除来源筛选" en="Clear source filter" /></Link> : null}
        </div>
      </div>

      <div className="admin-grid-3">
        <MetricCard label={<I18nText zh="等待中" en="Queued" />} value={queued} tone={queued > 0 ? "warn" : "normal"} />
        <MetricCard label={<I18nText zh="运行中" en="Running" />} value={running} tone={running > 0 ? "accent" : "normal"} />
        <MetricCard label={<I18nText zh="近 7 天失败" en="Failed (7d)" />} value={recentFailed} tone={recentFailed > 0 ? "danger" : "normal"} />
      </div>

      <div className="topic-tabs" style={{ marginTop: 24 }}>
        <Link
          className={!status ? "active" : ""}
          aria-current={!status ? "page" : undefined}
          href={sourceId ? `/admin/jobs?sourceId=${sourceId}` : "/admin/jobs"}
        >
          <I18nText zh="全部" en="All" />
        </Link>
        {JOB_STATUS_ORDER.map((item) => {
          const href = `/admin/jobs?status=${item}${sourceId ? `&sourceId=${sourceId}` : ""}`;
          return (
            <Link
              key={item}
              className={status === item ? "active" : ""}
              aria-current={status === item ? "page" : undefined}
              href={href}
            >
              <I18nText zh={JOB_STATUS_LABELS[item].zh} en={JOB_STATUS_LABELS[item].en} /> ({totalByStatus.get(item) || 0})
            </Link>
          );
        })}
      </div>

      <section className="admin-panel" style={{ marginTop: 24 }}>
        <div className="meta-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}><I18nText zh="最近任务" en="Recent Jobs" /></h2>
          <span className="muted"><I18nText zh={`显示最新 ${jobs.length} 条`} en={`Showing latest ${jobs.length}`} /></span>
        </div>
        {jobs.length === 0 ? (
          <div className="empty-state">
            <p><I18nText zh="暂无符合条件的任务。" en="No jobs matched the filters." /></p>
            <div className="row-actions">
              {(status || sourceId) ? <Link className="button secondary" href="/admin/jobs"><I18nText zh="清除筛选" en="Clear filters" /></Link> : null}
              <Link className="button" href="/admin"><I18nText zh="返回仪表盘启动任务" en="Start jobs from the dashboard" /></Link>
            </div>
          </div>
        ) : (
          <div className="table-list" style={{ marginTop: 12 }}>
            {jobs.map((job) => (
              <div className="table-item job-row" key={job.id}>
                <div>
                  <div className="meta-row" style={{ alignItems: "center" }}>
                    <strong>{getJobTitleLabel(job)}</strong>
                    <StatusPill status={job.status} />
                    {job.source?.status === "PAUSED" ? <span className="tag"><I18nText zh="来源已暂停" en="Source paused" /></span> : null}
                  </div>
                  <div className="muted">
                    {getJobKindLabel(job)} · <I18nText zh="创建" en="created" /> {formatDateTime(job.createdAt)} · <I18nText zh="耗时" en="took" /> {getJobDuration(job)} · <I18nText zh="原始条目" en="raw items" /> {job._count.rawItems}
                  </div>
                  {job.status === "QUEUED" || job.status === "RUNNING" ? (
                    <TaskProgress
                      compact
                      active
                      label={job.status === "QUEUED" ? "任务等待中" : "任务运行中"}
                      stage={job.status === "QUEUED"
                        ? "等待 worker 接手"
                        : parsePostRepairUrl(job.sourceUrl)
                          ? "正在按审核意见返修并复检"
                          : "正在采集、生成并执行最多 3 轮自动返修"}
                    />
                  ) : null}
                  {job.error ? (
                    <p className={job.status === "FAILED" ? "job-error" : "muted"}>
                      {storedJobDetail(job.error).slice(0, 300)}
                    </p>
                  ) : null}
                </div>
                <div className="row-actions">
                  <Link className="button secondary" href={`/admin/jobs/${job.id}`}><I18nText zh="详情" en="Details" /></Link>
                  {parsePostRepairUrl(job.sourceUrl) ? null : <form action="/api/admin/run" method="post">
                    {job.sourceId ? (
                      <input type="hidden" name="sourceId" value={job.sourceId} />
                    ) : (
                      <>
                        <input type="hidden" name="tempUrl" value={job.sourceUrl} />
                        <input type="hidden" name="tempType" value={job.sourceType} />
                      </>
                    )}
                    {job.contentStyleId ? <input type="hidden" name="contentStyleId" value={job.contentStyleId} /> : null}
                    <SubmitButton className="button secondary" pendingLabel={<I18nText zh="提交中…" en="Submitting…" />}><I18nText zh="重跑" en="Re-run" /></SubmitButton>
                  </form>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </AdminShell>
  );
}

function storedJobDetail(value: string) {
  const repair = decodePostRepairResult(value);
  if (!repair) return value;
  return [repair.message, repair.reason, repair.guidance].filter(Boolean).join("；");
}
