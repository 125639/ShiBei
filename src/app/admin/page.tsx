import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AdminShell } from "@/components/AdminShell";
import { I18nText } from "@/components/I18nText";
import { MetricCard } from "@/components/MetricCard";
import { RelativeTime } from "@/components/RelativeTime";
import { StatusPill } from "@/components/StatusPill";
import { requireAdmin } from "@/lib/auth";
import { hasLocalWorker } from "@/lib/app-mode";
import { getBuildInfo } from "@/lib/build-info";
import { getJobKindLabel, getJobTitleLabel } from "@/lib/job-utils";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type DashboardJob = Prisma.FetchJobGetPayload<{ include: { source: true } }>;

function getJobMeta(job: DashboardJob) {
  return `${getJobKindLabel(job)} · ${job.createdAt.toLocaleString("zh-CN")}`;
}

async function getSevenDayWindowStart() {
  const [row] = await prisma.$queryRaw<Array<{ since: Date }>>`
    SELECT CURRENT_TIMESTAMP - INTERVAL '7 days' AS "since"
  `;
  return row.since;
}

export default async function AdminDashboardPage() {
  await requireAdmin();
  const workerEnabled = hasLocalWorker();
  const since = await getSevenDayWindowStart();
  const [sources, defaultSources, drafts, published, videos, jobs, jobStatusSummary, postsCreated7d, published7d, failed7d, runningJobs] = await Promise.all([
    prisma.source.count(),
    prisma.source.count({ where: { isDefault: true, status: "ACTIVE" } }),
    prisma.post.count({ where: { status: "DRAFT" } }),
    prisma.post.count({ where: { status: "PUBLISHED" } }),
    prisma.video.count(),
    prisma.fetchJob.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { source: true } }),
    prisma.fetchJob.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.post.count({ where: { createdAt: { gte: since } } }),
    prisma.post.count({ where: { status: "PUBLISHED", publishedAt: { gte: since } } }),
    prisma.fetchJob.count({ where: { status: "FAILED", updatedAt: { gte: since } } }),
    prisma.fetchJob.count({ where: { status: "RUNNING" } })
  ]);
  const jobStats = jobStatusSummary.map((item) => ({ status: item.status, count: item._count._all }));
  const maxMetric = Math.max(postsCreated7d, published7d, failed7d, 1);
  const maxJobCount = Math.max(...jobStats.map((stat) => stat.count), 1);
  const buildInfo = getBuildInfo();

  return (
    <AdminShell>
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1><I18nText zh="管理后台" en="Admin Dashboard" /></h1>
        </div>
        <div className="admin-page-actions">
          {workerEnabled ? <Link className="button secondary" href="/admin/jobs"><I18nText zh="查看任务诊断" en="Job Diagnostics" /></Link> : null}
          <Link className="button secondary" href="/admin/settings"><I18nText zh="系统设置" en="Settings" /></Link>
        </div>
      </div>

      <div className="admin-grid-3">
        <MetricCard value={drafts} label={<I18nText zh="待审核草稿" en="Pending drafts" />} action={{ href: "/admin/posts", label: <I18nText zh="打开" en="Open" /> }} />
        {workerEnabled ? <MetricCard value={runningJobs} label={<I18nText zh="运行中任务" en="Running jobs" />} action={{ href: "/admin/jobs?status=RUNNING", label: <I18nText zh="打开" en="Open" /> }} /> : null}
        {workerEnabled ? <MetricCard value={failed7d} label={<I18nText zh="近 7 天失败任务" en="Failed jobs (7d)" />} tone={failed7d > 0 ? "danger" : "normal"} action={{ href: "/admin/jobs?status=FAILED", label: <I18nText zh="打开" en="Open" /> }} /> : null}
        {workerEnabled ? <MetricCard value={`${defaultSources} / ${sources}`} label={<I18nText zh="默认 / 总来源" en="Default / total sources" />} action={{ href: "/admin/sources", label: <I18nText zh="打开" en="Open" /> }} /> : null}
        <MetricCard value={published} label={<I18nText zh="已发布文章" en="Published posts" />} action={{ href: "/admin/posts", label: <I18nText zh="打开" en="Open" /> }} />
        <MetricCard value={videos} label={<I18nText zh="视频资源" en="Videos" />} action={{ href: "/admin/videos", label: <I18nText zh="打开" en="Open" /> }} />
      </div>

      {workerEnabled ? <section className="admin-panel" style={{ marginTop: 24 }}>
        <h2><I18nText zh="内容生成" en="Generate Content" /></h2>
        <p className="muted"><I18nText zh="按来源抓取、让 AI 管理员规划任务，或配置定时自动内容——具体操作都在各自的页面里。" en="Fetch from sources, delegate a task to the AI admin, or set up scheduled auto-curation — each lives on its own page." /></p>
        <div className="row-actions" style={{ justifyContent: "flex-start" }}>
          <Link className="button secondary" href="/admin/sources"><I18nText zh="来源库" en="Sources" /></Link>
          <Link className="button secondary" href="/admin/ai"><I18nText zh="AI 管理员" en="AI Admin" /></Link>
          <Link className="button secondary" href="/admin/auto-curation"><I18nText zh="自动内容" en="Auto-Curation" /></Link>
        </div>
      </section> : null}

      <section className="admin-panel" style={{ marginTop: 24 }}>
        <h2><I18nText zh="工作成效" en="Throughput" /></h2>
        <div className="stats-grid">
          <MetricBar label={<I18nText zh="近 7 天生成文章" en="Posts created (7d)" />} value={postsCreated7d} max={maxMetric} />
          <MetricBar label={<I18nText zh="近 7 天发布文章" en="Posts published (7d)" />} value={published7d} max={maxMetric} />
          {workerEnabled ? <MetricBar label={<I18nText zh="近 7 天失败任务" en="Failed jobs (7d)" />} value={failed7d} max={maxMetric} /> : null}
        </div>
        {workerEnabled ? <div className="stats-grid" style={{ marginTop: 24 }}>
          {jobStats.map((item) => (
            <MetricBar key={item.status} label={<I18nText zh={`任务 ${item.status}`} en={`Jobs ${item.status}`} />} value={item.count} max={maxJobCount} />
          ))}
        </div> : null}
      </section>

      {workerEnabled ? <section className="admin-panel" style={{ marginTop: 24 }}>
        <div className="meta-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}><I18nText zh="最近任务" en="Recent Jobs" /></h2>
          <Link className="text-link" href="/admin/jobs"><I18nText zh="查看全部任务" en="View all jobs" /></Link>
        </div>
        <div className="table-list">
          {jobs.map((job) => (
            <div className="table-item" key={job.id}>
              <div>
                <strong>{getJobTitleLabel(job)}</strong>
                <div className="muted">{getJobMeta(job)} · <RelativeTime value={job.createdAt} /> · {getJobDuration(job)}</div>
                {job.error ? <p className="muted"><I18nText zh="错误" en="Error" />：{job.error}</p> : null}
              </div>
              <div className="row-actions">
                <StatusPill status={job.status} />
                <Link className="button secondary" href={`/admin/jobs/${job.id}`}><I18nText zh="详情" en="Details" /></Link>
              </div>
            </div>
          ))}
        </div>
      </section> : null}

      <p className="muted" style={{ marginTop: 24, fontSize: 12 }}>
        <I18nText zh="构建版本" en="Build" />：{buildInfo.commit}
        {buildInfo.builtAt ? ` · ${buildInfo.builtAt}` : ""}
      </p>
    </AdminShell>
  );
}

function MetricBar({ label, value, max }: { label: React.ReactNode; value: number; max: number }) {
  return (
    <div className="metric-card">
      <div className="meta-row">
        <strong>{label}</strong>
        <span>{value}</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${Math.max(4, Math.round((value / max) * 100))}%` }} />
      </div>
    </div>
  );
}

function getJobDuration(job: DashboardJob) {
  const end = job.completedAt || (job.status === "RUNNING" ? new Date() : job.updatedAt);
  const seconds = Math.max(0, Math.round((end.getTime() - job.createdAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}min`;
}
