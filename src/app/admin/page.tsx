import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AdminShell } from "@/components/AdminShell";
import { ContentStyleSelect } from "@/components/ContentStyleSelect";
import { I18nText } from "@/components/I18nText";
import { MetricCard } from "@/components/MetricCard";
import { RelativeTime } from "@/components/RelativeTime";
import { StatusPill } from "@/components/StatusPill";
import { SubmitButton } from "@/components/SubmitButton";
import { requireAdmin } from "@/lib/auth";
import { getBuildInfo } from "@/lib/build-info";
import { getJobKindLabel, getJobTitleLabel } from "@/lib/job-utils";
import { prisma } from "@/lib/prisma";

type DashboardJob = Prisma.FetchJobGetPayload<{ include: { source: true } }>;

function getJobMeta(job: DashboardJob) {
  return `${getJobKindLabel(job)} · ${job.createdAt.toLocaleString("zh-CN")}`;
}

export default async function AdminDashboardPage() {
  await requireAdmin();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [sources, defaultSources, drafts, published, videos, jobs, jobStatusSummary, postsCreated7d, published7d, failed7d, runningJobs, contentStyles] = await Promise.all([
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
    prisma.fetchJob.count({ where: { status: "RUNNING" } }),
    prisma.contentStyle.findMany({
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      select: { id: true, name: true, contentMode: true, isDefault: true },
      take: 100
    })
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
          <Link className="button secondary" href="/admin/jobs"><I18nText zh="查看任务诊断" en="Job Diagnostics" /></Link>
          <Link className="button secondary" href="/admin/settings"><I18nText zh="系统设置" en="Settings" /></Link>
        </div>
      </div>

      <div className="admin-grid-3">
        <MetricCard value={drafts} label={<I18nText zh="待审核草稿" en="Pending drafts" />} action={{ href: "/admin/posts", label: <I18nText zh="打开" en="Open" /> }} />
        <MetricCard value={runningJobs} label={<I18nText zh="运行中任务" en="Running jobs" />} action={{ href: "/admin/jobs?status=RUNNING", label: <I18nText zh="打开" en="Open" /> }} />
        <MetricCard value={failed7d} label={<I18nText zh="近 7 天失败任务" en="Failed jobs (7d)" />} tone={failed7d > 0 ? "danger" : "normal"} action={{ href: "/admin/jobs?status=FAILED", label: <I18nText zh="打开" en="Open" /> }} />
        <MetricCard value={`${defaultSources} / ${sources}`} label={<I18nText zh="默认 / 总来源" en="Default / total sources" />} action={{ href: "/admin/sources", label: <I18nText zh="打开" en="Open" /> }} />
        <MetricCard value={published} label={<I18nText zh="已发布文章" en="Published posts" />} action={{ href: "/admin/posts", label: <I18nText zh="打开" en="Open" /> }} />
        <MetricCard value={videos} label={<I18nText zh="视频资源" en="Videos" />} action={{ href: "/admin/videos", label: <I18nText zh="打开" en="Open" /> }} />
      </div>

      <div className="admin-action-grid" style={{ marginTop: 24 }}>
        <section className="admin-panel">
          <h2><I18nText zh="默认来源抓取" en="Fetch Default Sources" /></h2>
          <form className="form-stack" action="/api/admin/run" method="post">
            <ContentStyleSelect styles={contentStyles} id="defaultContentStyleId" />
            <SubmitButton pendingLabel={<I18nText zh="正在创建任务…" en="Creating jobs…" />}><I18nText zh="开始抓取" en="Start Fetching" /></SubmitButton>
            <p className="muted">
              <I18nText
                zh={`当前会从 ${defaultSources} 个启用的默认来源创建任务。`}
                en={`Jobs will be created from ${defaultSources} enabled default sources.`}
              />
            </p>
          </form>
        </section>
        <section className="admin-panel">
          <h2><I18nText zh="关键词生成文章" en="Generate from Keyword" /></h2>
          <form className="form-stack" action="/api/admin/run" method="post">
            <div className="field">
              <label htmlFor="keyword"><I18nText zh="关键词或选题" en="Keyword or topic" /></label>
              <input id="keyword" name="keyword" required placeholder="例如：人工智能监管 / Nvidia 财报" />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="keywordScope"><I18nText zh="搜索范围" en="Search scope" /></label>
                <select id="keywordScope" name="keywordScope" defaultValue="all">
                  <option value="all">国内 + 国外 / All</option>
                  <option value="domestic">国内来源 / Domestic</option>
                  <option value="international">国外来源 / International</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="articleCount"><I18nText zh="生成篇数" en="Article count" /></label>
                <input id="articleCount" name="articleCount" type="number" min="1" max="5" defaultValue="1" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="articleDepth"><I18nText zh="文章长度" en="Article length" /></label>
              <select id="articleDepth" name="articleDepth" defaultValue="long">
                <option value="standard">标准（≥1100 字）/ Standard</option>
                <option value="long">长文（≥1900 字）/ Long</option>
                <option value="deep">深度长文（≥3000 字）/ In-depth</option>
              </select>
            </div>
            <ContentStyleSelect styles={contentStyles} id="keywordContentStyleId" />
            <SubmitButton pendingLabel={<I18nText zh="正在创建任务…" en="Creating jobs…" />}><I18nText zh="生成草稿" en="Generate Draft" /></SubmitButton>
          </form>
        </section>
      </div>

      <section className="admin-panel" style={{ marginTop: 24 }}>
        <h2><I18nText zh="工作成效" en="Throughput" /></h2>
        <div className="stats-grid">
          <MetricBar label={<I18nText zh="近 7 天生成文章" en="Posts created (7d)" />} value={postsCreated7d} max={maxMetric} />
          <MetricBar label={<I18nText zh="近 7 天发布文章" en="Posts published (7d)" />} value={published7d} max={maxMetric} />
          <MetricBar label={<I18nText zh="近 7 天失败任务" en="Failed jobs (7d)" />} value={failed7d} max={maxMetric} />
        </div>
        <div className="stats-grid" style={{ marginTop: 24 }}>
          {jobStats.map((item) => (
            <MetricBar key={item.status} label={<I18nText zh={`任务 ${item.status}`} en={`Jobs ${item.status}`} />} value={item.count} max={maxJobCount} />
          ))}
        </div>
      </section>

      <section className="admin-panel" style={{ marginTop: 24 }}>
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
      </section>

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
