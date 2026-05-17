import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AdminShell } from "@/components/AdminShell";
import { StatusPill } from "@/components/StatusPill";
import { requireAdmin } from "@/lib/auth";
import { JOB_STATUS_LABELS, JOB_STATUS_ORDER, isJobStatus } from "@/lib/job-status";
import { prisma } from "@/lib/prisma";
import { parseKeywordResearchUrl, researchScopeLabel } from "@/lib/research";

export const dynamic = "force-dynamic";

type JobRow = Prisma.FetchJobGetPayload<{
  include: {
    source: { select: { id: true; name: true; url: true; status: true } };
    contentTopic: { select: { id: true; name: true; slug: true } };
    _count: { select: { rawItems: true } };
  };
}>;

function formatDateTime(value: Date | null | undefined) {
  if (!value) return "—";
  return value.toLocaleString("zh-CN");
}

function getJobTitle(job: JobRow) {
  const keywordResearch = parseKeywordResearchUrl(job.sourceUrl);
  if (keywordResearch) return `关键词生成：${keywordResearch.keyword}`;
  return job.contentTopic?.name || job.source?.name || job.sourceUrl;
}

function getJobKind(job: JobRow) {
  const keywordResearch = parseKeywordResearchUrl(job.sourceUrl);
  if (keywordResearch) {
    return `关键词研究 · ${researchScopeLabel(keywordResearch.scope)} · ${keywordResearch.count} 篇 · ${keywordResearch.depth}`;
  }
  return job.sourceType;
}

function getDuration(job: JobRow) {
  const end = job.completedAt || (job.status === "RUNNING" ? new Date() : job.updatedAt);
  const seconds = Math.max(0, Math.round((end.getTime() - job.createdAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`;
  return `${(seconds / 3600).toFixed(1)} 小时`;
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
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

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
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">Jobs</p>
          <h1>任务诊断</h1>
          {source ? (
            <p className="muted">
              当前只看来源：<strong>{source.name}</strong> · {source.url}
            </p>
          ) : null}
        </div>
        <div className="admin-page-actions">
          <Link className="button secondary" href="/admin">返回仪表盘</Link>
          {sourceId ? <Link className="button secondary" href="/admin/jobs">清除来源筛选</Link> : null}
        </div>
      </div>

      <div className="admin-grid-3">
        <Metric label="等待中" value={queued} tone={queued > 0 ? "warn" : "normal"} />
        <Metric label="运行中" value={running} tone={running > 0 ? "accent" : "normal"} />
        <Metric label="近 7 天失败" value={recentFailed} tone={recentFailed > 0 ? "danger" : "normal"} />
      </div>

      <div className="topic-tabs" style={{ marginTop: 18 }}>
        <Link
          className={!status ? "active" : ""}
          aria-current={!status ? "page" : undefined}
          href={sourceId ? `/admin/jobs?sourceId=${sourceId}` : "/admin/jobs"}
        >
          全部
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
              {JOB_STATUS_LABELS[item].zh} ({totalByStatus.get(item) || 0})
            </Link>
          );
        })}
      </div>

      <section className="admin-panel" style={{ marginTop: 18 }}>
        <div className="meta-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>最近任务</h2>
          <span className="muted">显示最新 {jobs.length} 条</span>
        </div>
        {jobs.length === 0 ? (
          <div className="empty-state">
            <p>暂无符合条件的任务。</p>
            <div className="row-actions">
              {(status || sourceId) ? <Link className="button secondary" href="/admin/jobs">清除筛选</Link> : null}
              <Link className="button" href="/admin">返回仪表盘启动任务</Link>
            </div>
          </div>
        ) : (
          <div className="table-list" style={{ marginTop: 12 }}>
            {jobs.map((job) => (
              <div className="table-item job-row" key={job.id}>
                <div>
                  <div className="meta-row" style={{ alignItems: "center" }}>
                    <strong>{getJobTitle(job)}</strong>
                    <StatusPill status={job.status} />
                    {job.source?.status === "PAUSED" ? <span className="tag">来源已暂停</span> : null}
                  </div>
                  <div className="muted">
                    {getJobKind(job)} · 创建 {formatDateTime(job.createdAt)} · 耗时 {getDuration(job)} · 原始条目 {job._count.rawItems}
                  </div>
                  {job.error ? <p className="job-error">{job.error.slice(0, 220)}</p> : null}
                </div>
                <div className="row-actions">
                  <Link className="button secondary" href={`/admin/jobs/${job.id}`}>详情</Link>
                  <form action="/api/admin/run" method="post">
                    {job.sourceId ? (
                      <input type="hidden" name="sourceId" value={job.sourceId} />
                    ) : (
                      <>
                        <input type="hidden" name="tempUrl" value={job.sourceUrl} />
                        <input type="hidden" name="tempType" value={job.sourceType} />
                      </>
                    )}
                    {job.contentStyleId ? <input type="hidden" name="contentStyleId" value={job.contentStyleId} /> : null}
                    <button className="button secondary" type="submit">重跑</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </AdminShell>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "normal" | "accent" | "warn" | "danger" }) {
  return (
    <div className={`metric-card metric-${tone}`}>
      <div style={{ fontSize: 28, fontWeight: 600, fontFamily: "var(--font-display)" }}>{value}</div>
      <div className="muted" style={{ fontSize: 13 }}>{label}</div>
    </div>
  );
}
