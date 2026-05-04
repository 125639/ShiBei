import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AdminShell } from "@/components/AdminShell";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseKeywordResearchUrl, researchScopeLabel } from "@/lib/research";

type DashboardJob = Prisma.FetchJobGetPayload<{ include: { source: true } }>;

function getJobTitle(job: DashboardJob) {
  const keywordResearch = parseKeywordResearchUrl(job.sourceUrl);
  if (keywordResearch) return `关键词写新闻：${keywordResearch.keyword}`;
  return job.source?.name || job.sourceUrl;
}

function getJobMeta(job: DashboardJob) {
  const keywordResearch = parseKeywordResearchUrl(job.sourceUrl);
  const type = keywordResearch
    ? `关键词研究 · ${researchScopeLabel(keywordResearch.scope)} · ${keywordResearch.count} 篇 · ${keywordResearch.depth}`
    : job.sourceType;
  return `${type} · ${job.createdAt.toLocaleString("zh-CN")}`;
}

export default async function AdminDashboardPage() {
  await requireAdmin();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [sources, drafts, published, jobs, jobStatusSummary, postsCreated7d, published7d, failed7d] = await Promise.all([
    prisma.source.count(),
    prisma.post.count({ where: { status: "DRAFT" } }),
    prisma.post.count({ where: { status: "PUBLISHED" } }),
    prisma.fetchJob.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { source: true } }),
    prisma.fetchJob.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.post.count({ where: { createdAt: { gte: since } } }),
    prisma.post.count({ where: { status: "PUBLISHED", publishedAt: { gte: since } } }),
    prisma.fetchJob.count({ where: { status: "FAILED", updatedAt: { gte: since } } })
  ]);
  const jobStats = jobStatusSummary.map((item) => ({ status: item.status, count: item._count._all }));
  const maxMetric = Math.max(postsCreated7d, published7d, failed7d, 1);

  return (
    <AdminShell>
      <p className="eyebrow">Dashboard</p>
      <h1>管理后台</h1>
      <div className="admin-grid">
        <div className="admin-panel">
          <h2>{sources}</h2>
          <p>信息源</p>
          <Link className="text-link" href="/admin/sources">管理来源</Link>
        </div>
        <div className="admin-panel">
          <h2>{drafts}</h2>
          <p>待审核草稿</p>
          <Link className="text-link" href="/admin/posts">审核草稿</Link>
        </div>
        <div className="admin-panel">
          <h2>{published}</h2>
          <p>已发布文章</p>
        </div>
        <div className="admin-panel">
          <h2>运行任务</h2>
          <form className="form-stack" action="/api/admin/run" method="post">
            <button className="button" type="submit">抓取默认信息源并总结</button>
            <p className="muted">将使用默认模型配置与默认总结风格。</p>
          </form>
        </div>
        <div className="admin-panel">
          <h2>关键词写新闻</h2>
          <form className="form-stack" action="/api/admin/run" method="post">
            <div className="field">
              <label htmlFor="keyword">关键词或选题</label>
              <input id="keyword" name="keyword" required placeholder="例如：人工智能监管 / Nvidia 财报" />
            </div>
            <div className="field">
              <label htmlFor="keywordScope">搜索范围</label>
              <select id="keywordScope" name="keywordScope" defaultValue="all">
                <option value="all">国内 + 国外</option>
                <option value="domestic">国内来源</option>
                <option value="international">国外来源</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="articleCount">生成篇数</label>
              <input id="articleCount" name="articleCount" type="number" min="1" max="5" defaultValue="1" />
            </div>
            <div className="field">
              <label htmlFor="articleDepth">报道长度</label>
              <select id="articleDepth" name="articleDepth" defaultValue="long">
                <option value="standard">标准报道（约 1200 字）</option>
                <option value="long">长报道（约 2000 字）</option>
                <option value="deep">深度报道（约 3200 字）</option>
              </select>
            </div>
            <button className="button" type="submit">搜索资料并写新闻草稿</button>
            <p className="muted">先按关键词从多个来源找材料，再按你选择的篇数和长度生成报道草稿。</p>
          </form>
        </div>
      </div>

      <section className="admin-panel" style={{ marginTop: 18 }}>
        <h2>工作成效</h2>
        <div className="stats-grid">
          <MetricBar label="近 7 天生成文章" value={postsCreated7d} max={maxMetric} />
          <MetricBar label="近 7 天发布文章" value={published7d} max={maxMetric} />
          <MetricBar label="近 7 天失败任务" value={failed7d} max={maxMetric} />
        </div>
        <div className="stats-grid" style={{ marginTop: 18 }}>
          {jobStats.map((item) => (
            <MetricBar key={item.status} label={`任务 ${item.status}`} value={item.count} max={Math.max(...jobStats.map((stat) => stat.count), 1)} />
          ))}
        </div>
      </section>

      <section className="admin-panel" style={{ marginTop: 18 }}>
        <h2>任务状态表</h2>
        <div className="table-list">
          {jobs.map((job) => (
            <div className="table-item" key={job.id}>
              <div>
                <strong>{getJobTitle(job)}</strong>
                <div className="muted">{getJobMeta(job)}</div>
                <div className="progress-track" aria-label={`任务进度 ${getJobProgress(job)}%`}>
                  <div className="progress-fill" style={{ width: `${getJobProgress(job)}%` }} />
                </div>
                <div className="muted">进度 {getJobProgress(job)}% · {getJobDuration(job)}</div>
                {job.error ? <p className="muted">错误：{job.error}</p> : null}
              </div>
              <span className="tag">{job.status}</span>
            </div>
          ))}
        </div>
      </section>
    </AdminShell>
  );
}

function MetricBar({ label, value, max }: { label: string; value: number; max: number }) {
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

function getJobProgress(job: DashboardJob) {
  if (job.status === "COMPLETED") return 100;
  if (job.status === "RUNNING") return 60;
  if (job.status === "FAILED") return 100;
  return 10;
}

function getJobDuration(job: DashboardJob) {
  const end = job.completedAt || (job.status === "RUNNING" ? new Date() : job.updatedAt);
  const seconds = Math.max(0, Math.round((end.getTime() - job.createdAt.getTime()) / 1000));
  if (seconds < 60) return `耗时 ${seconds} 秒`;
  return `耗时 ${Math.round(seconds / 60)} 分钟`;
}
