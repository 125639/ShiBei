import { AdminLink as Link } from "@/components/admin/AdminLink";
import { AdminIcon } from "@/components/admin/icons";
import { StackedBarChart } from "@/components/Charts";
import { I18nText } from "@/components/I18nText";
import { MetricCard } from "@/components/MetricCard";
import { RelativeTime } from "@/components/RelativeTime";
import { StatusPill } from "@/components/StatusPill";
import { requireAdmin } from "@/lib/auth";
import { hasLocalWorker } from "@/lib/app-mode";
import { getJobKindLabel, getJobTitleLabel } from "@/lib/job-utils";
import { prisma } from "@/lib/prisma";
import { siteDayKey, siteDayStartOffset, siteDayKeyOf, siteShortLabel } from "@/lib/site-time";
import { ADMIN_JOB_LIST_SELECT, getAdminJobCounts, summarizeAdminJobs, type AdminJobListEntry } from "@/lib/admin-job-data";
import type { StatsBucket } from "@/lib/stats";

export const dynamic = "force-dynamic";

type DashboardJob = AdminJobListEntry;

function getJobMeta(job: DashboardJob) {
  return `${getJobKindLabel(job)} · ${job.createdAt.toLocaleString("zh-CN")}`;
}

export default async function AdminDashboardPage() {
  await requireAdmin();
  const workerEnabled = hasLocalWorker();
  const trendSince = siteDayStartOffset(6);
  const [sourceCounts, postCounts, videos, jobs, jobStats, createdPosts, publishedPosts] = await Promise.all([
    workerEnabled ? prisma.$queryRaw<Array<{ sources: number; defaults: number }>>`
      SELECT COUNT(*)::int AS sources, (COUNT(*) FILTER (WHERE "isDefault" AND status = 'ACTIVE'))::int AS defaults FROM "Source"
    ` : [{ sources: 0, defaults: 0 }],
    prisma.$queryRaw<Array<{ drafts: number; published: number; created7d: number; published7d: number }>>`
      SELECT (COUNT(*) FILTER (WHERE status = 'DRAFT'))::int AS drafts,
        (COUNT(*) FILTER (WHERE status = 'PUBLISHED'))::int AS published,
        (COUNT(*) FILTER (WHERE "createdAt" >= CURRENT_TIMESTAMP - INTERVAL '7 days'))::int AS "created7d",
        (COUNT(*) FILTER (WHERE status = 'PUBLISHED' AND "publishedAt" >= CURRENT_TIMESTAMP - INTERVAL '7 days'))::int AS "published7d"
      FROM "Post"
    `,
    prisma.video.count(),
    workerEnabled ? prisma.fetchJob.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 8, select: ADMIN_JOB_LIST_SELECT }) : [],
    workerEnabled ? getAdminJobCounts() : [],
    prisma.post.findMany({ where: { createdAt: { gte: trendSince } }, select: { createdAt: true } }),
    prisma.post.findMany({ where: { status: "PUBLISHED", publishedAt: { gte: trendSince } }, select: { publishedAt: true } })
  ]);
  const { sources, defaults: defaultSources } = sourceCounts[0];
  const { drafts, published, created7d: postsCreated7d, published7d } = postCounts[0];
  const { running: runningJobs, failed7d } = summarizeAdminJobs(jobStats);
  const maxJobCount = Math.max(...jobStats.map((stat) => stat.count), 1);
  const createdBuckets = bucketBySiteDay(createdPosts.map((post) => post.createdAt));
  const publishedBuckets = bucketBySiteDay(publishedPosts.map((post) => post.publishedAt as Date));

  return (
    <>
      <div className="admin-page-header">
        <h1><I18nText zh="管理后台" en="Admin" /></h1>
        <div className="admin-page-actions">
          {workerEnabled ? <Link className="button secondary" href="/admin/jobs"><I18nText zh="任务诊断" en="Job Diagnostics" /></Link> : null}
          <Link className="button secondary" href="/admin/stats"><I18nText zh="数据看板" en="Stats" /></Link>
        </div>
      </div>

      <div className="admin-dash-stats">
        <MetricCard
          icon={<AdminIcon name="file-text" size={17} />}
          value={drafts}
          label={<I18nText zh="待审核草稿" en="Pending drafts" />}
          action={{ href: "/admin/posts", label: <I18nText zh="打开" en="Open" /> }}
        />
        <MetricCard
          icon={<AdminIcon name="send" size={17} />}
          value={published}
          label={<I18nText zh="已发布文章" en="Published posts" />}
          action={{ href: "/admin/posts", label: <I18nText zh="打开" en="Open" /> }}
        />
        <MetricCard
          icon={<AdminIcon name="video" size={17} />}
          value={videos}
          label={<I18nText zh="视频资源" en="Videos" />}
          action={{ href: "/admin/videos", label: <I18nText zh="打开" en="Open" /> }}
        />
        {workerEnabled ? (
          <MetricCard
            icon={<AdminIcon name="rss" size={17} />}
            value={`${defaultSources} / ${sources}`}
            label={<I18nText zh="默认 / 总来源" en="Default / total sources" />}
            action={{ href: "/admin/sources", label: <I18nText zh="打开" en="Open" /> }}
          />
        ) : null}
        {workerEnabled ? (
          <MetricCard
            icon={<AdminIcon name="activity" size={17} />}
            value={runningJobs}
            label={<I18nText zh="运行中任务" en="Running jobs" />}
            action={{ href: "/admin/jobs?status=RUNNING", label: <I18nText zh="打开" en="Open" /> }}
          />
        ) : null}
        {workerEnabled ? (
          <MetricCard
            icon={<AdminIcon name="alert" size={17} />}
            value={failed7d}
            tone={failed7d > 0 ? "danger" : "normal"}
            label={<I18nText zh="近 7 天失败任务" en="Failed jobs (7d)" />}
            action={{ href: "/admin/jobs?status=FAILED", label: <I18nText zh="打开" en="Open" /> }}
          />
        ) : null}
      </div>

      <div className="admin-dash-grid" style={{ marginTop: 14 }}>
        <section className="admin-panel">
          <h2><I18nText zh="近 7 天内容趋势" en="Content trend (7d)" /></h2>
          <StackedBarChart
            primary={createdBuckets}
            secondary={publishedBuckets}
            primaryLabel={<I18nText zh="生成" en="Created" />}
            secondaryLabel={<I18nText zh="发布" en="Published" />}
            ariaLabel="近 7 天内容趋势"
            height={210}
          />
        </section>
        <section className="admin-panel">
          <h2><I18nText zh="任务概览" en="Jobs overview" /></h2>
          {workerEnabled && jobStats.length > 0 ? (
            <div className="stats-grid">
              {jobStats.map((item) => (
                <MetricBar key={item.status} label={<I18nText zh={`任务 ${item.status}`} en={`Jobs ${item.status}`} />} value={item.count} max={maxJobCount} />
              ))}
            </div>
          ) : (
            <p className="muted">
              {workerEnabled ? (
                <I18nText zh="暂无任务记录。去来源库触发一次抓取，或让 AI 管理员执行一个计划。" en="No jobs yet. Trigger a fetch from Sources or delegate a plan to the AI admin." />
              ) : (
                <I18nText zh="当前部署未启用本地任务 Worker。" en="This deployment does not run a local job worker." />
              )}
            </p>
          )}
        </section>
      </div>

      {workerEnabled ? (
        <section className="admin-panel" style={{ marginTop: 14 }}>
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
                  {job.error ? <p className="muted"><I18nText zh="错误" en="Error" />：{job.error.slice(0, 220)}{job.error.length > 220 ? "…" : ""}</p> : null}
                </div>
                <div className="row-actions">
                  <StatusPill status={job.status} />
                  <Link className="button secondary" href={`/admin/jobs/${job.id}`}><I18nText zh="详情" en="Details" /></Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="admin-panel" style={{ marginTop: 14 }}>
        <h2><I18nText zh="快捷入口" en="Quick actions" /></h2>
        <div className="admin-quick-grid">
          {workerEnabled ? (
            <Link className="admin-quick-card" href="/admin/sources">
              <strong><AdminIcon name="rss" size={16} /><I18nText zh="来源库" en="Sources" /></strong>
              <span><I18nText zh="管理 RSS 与视频信息源，手动触发抓取。" en="Manage RSS and video sources; trigger a fetch manually." /></span>
            </Link>
          ) : null}
          {workerEnabled ? (
            <Link className="admin-quick-card" href="/admin/ai">
              <strong><AdminIcon name="bot" size={16} /><I18nText zh="AI 管理员" en="AI Admin" /></strong>
              <span><I18nText zh="用一句话把采集、写作、发布委托给 AI。" en="Delegate collecting, writing, and publishing to AI in one sentence." /></span>
            </Link>
          ) : null}
          {workerEnabled ? (
            <Link className="admin-quick-card" href="/admin/auto-curation">
              <strong><AdminIcon name="calendar-clock" size={16} /><I18nText zh="自动内容" en="Auto-Curation" /></strong>
              <span><I18nText zh="配置定时计划，让站点自动产出内容。" en="Schedule plans so the site produces content on its own." /></span>
            </Link>
          ) : null}
          <Link className="admin-quick-card" href="/admin/settings">
            <strong><AdminIcon name="settings" size={16} /><I18nText zh="系统设置" en="Settings" /></strong>
            <span><I18nText zh="站点外观、评论与社区、账号安全。" en="Site appearance, comments & community, account security." /></span>
          </Link>
        </div>
      </section>
    </>
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

// 与公开站统计口径一致：按站点时区归日（siteDayKeyOf），而不是数据库会话时区。
function bucketBySiteDay(instants: Date[]): StatsBucket[] {
  const counts = new Map<string, number>();
  for (const instant of instants) {
    const key = siteDayKeyOf(instant);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const buckets: StatsBucket[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = siteDayStartOffset(i);
    const key = siteDayKey(day);
    buckets.push({ label: siteShortLabel(day), date: key, count: counts.get(key) || 0 });
  }
  return buckets;
}

function getJobDuration(job: DashboardJob) {
  const end = job.completedAt || (job.status === "RUNNING" ? new Date() : job.updatedAt);
  const seconds = Math.max(0, Math.round((end.getTime() - job.createdAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}min`;
}
