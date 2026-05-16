import Link from "next/link";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { AdminShell } from "@/components/AdminShell";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseKeywordResearchUrl, researchScopeLabel } from "@/lib/research";
import { formatBytes } from "@/lib/storage";

export const dynamic = "force-dynamic";

type JobDetail = Prisma.FetchJobGetPayload<{
  include: {
    source: true;
    contentTopic: true;
    rawItems: {
      include: {
        post: {
          include: {
            videos: true;
            tags: true;
          };
        };
      };
    };
  };
}>;

function formatDateTime(value: Date | null | undefined) {
  if (!value) return "—";
  return value.toLocaleString("zh-CN");
}

function getDuration(job: JobDetail) {
  const end = job.completedAt || (job.status === "RUNNING" ? new Date() : job.updatedAt);
  const seconds = Math.max(0, Math.round((end.getTime() - job.createdAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`;
  return `${(seconds / 3600).toFixed(1)} 小时`;
}

function getJobTitle(job: JobDetail) {
  const keywordResearch = parseKeywordResearchUrl(job.sourceUrl);
  if (keywordResearch) return `关键词生成：${keywordResearch.keyword}`;
  return job.contentTopic?.name || job.source?.name || job.sourceUrl;
}

function getJobKind(job: JobDetail) {
  const keywordResearch = parseKeywordResearchUrl(job.sourceUrl);
  if (keywordResearch) {
    return `关键词研究 · ${researchScopeLabel(keywordResearch.scope)} · ${keywordResearch.count} 篇 · ${keywordResearch.depth}`;
  }
  return job.sourceType;
}

function statusClass(status: string) {
  return `status-pill status-${status.toLowerCase()}`;
}

function shortText(value: string | null | undefined, length = 160) {
  if (!value) return "";
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

export default async function AdminJobDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const job = await prisma.fetchJob.findUnique({
    where: { id },
    include: {
      source: true,
      contentTopic: true,
      rawItems: {
        include: {
          post: {
            include: {
              videos: true,
              tags: true
            }
          }
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!job) notFound();

  const rawItemsWithPosts = job.rawItems.filter((item) => item.post);
  const videos = rawItemsWithPosts.flatMap((item) => item.post?.videos || []);
  const localVideos = videos.filter((video) => video.type === "LOCAL");
  const totalLocalBytes = localVideos.reduce((sum, video) => sum + (video.fileSizeBytes || 0), 0);

  return (
    <AdminShell>
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">Job Detail</p>
          <h1>{getJobTitle(job)}</h1>
          <div className="meta-row">
            <span className={statusClass(job.status)}>{job.status}</span>
            <span className="tag">{getJobKind(job)}</span>
            {job.source ? <span className="tag">{job.source.name}</span> : null}
          </div>
        </div>
        <div className="admin-page-actions">
          <Link className="button secondary" href="/admin/jobs">任务列表</Link>
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
            <button className="button" type="submit">重跑任务</button>
          </form>
        </div>
      </div>

      <div className="admin-grid-3">
        <Metric label="原始条目" value={job.rawItems.length} />
        <Metric label="生成文章" value={rawItemsWithPosts.length} />
        <Metric label="本地视频" value={`${localVideos.length} / ${formatBytes(totalLocalBytes)}`} />
      </div>

      <section className="admin-panel" style={{ marginTop: 18 }}>
        <h2>执行信息</h2>
        <div className="diagnostic-grid">
          <Info label="任务 ID" value={job.id} mono />
          <Info label="来源 URL" value={job.sourceUrl} />
          <Info label="来源类型" value={job.sourceType} />
          <Info label="创建时间" value={formatDateTime(job.createdAt)} />
          <Info label="更新时间" value={formatDateTime(job.updatedAt)} />
          <Info label="完成时间" value={formatDateTime(job.completedAt)} />
          <Info label="耗时" value={getDuration(job)} />
          <Info label="模型配置" value={job.modelConfigId || "使用默认"} mono={Boolean(job.modelConfigId)} />
          <Info label="内容风格" value={job.contentStyleId || "使用默认"} mono={Boolean(job.contentStyleId)} />
          <Info label="自动主题" value={job.contentTopic?.name || "无"} />
        </div>
        {job.error ? (
          <div className="diagnostic-error">
            <strong>错误信息</strong>
            <pre>{job.error}</pre>
          </div>
        ) : null}
      </section>

      <section className="admin-panel" style={{ marginTop: 18 }}>
        <h2>产物</h2>
        {job.rawItems.length === 0 ? (
          <p className="muted">还没有原始条目。若任务已失败，优先查看上方错误信息。</p>
        ) : (
          <div className="table-list">
            {job.rawItems.map((rawItem) => (
              <div className="table-item job-artifact" key={rawItem.id}>
                <div>
                  <strong>{rawItem.title}</strong>
                  <div className="muted">
                    原始条目：<code>{rawItem.id}</code> · 创建 {formatDateTime(rawItem.createdAt)}
                  </div>
                  <div className="muted">{shortText(rawItem.url, 220)}</div>
                  {rawItem.post ? (
                    <div className="artifact-post">
                      <div className="meta-row" style={{ alignItems: "center" }}>
                        <span className="tag">{rawItem.post.status}</span>
                        <strong>{rawItem.post.title}</strong>
                      </div>
                      <p className="muted">{shortText(rawItem.post.summary, 220)}</p>
                      <div className="meta-row">
                        <Link className="text-link" href={`/admin/posts/${rawItem.post.id}`}>编辑文章</Link>
                        <Link className="text-link" href={`/posts/${rawItem.post.slug}`}>查看前台</Link>
                        {rawItem.post.videos.length ? <span>视频 {rawItem.post.videos.length}</span> : null}
                        {rawItem.post.tags.length ? <span>标签 {rawItem.post.tags.map((tag) => tag.name).join(" / ")}</span> : null}
                      </div>
                      {rawItem.post.videos.length ? (
                        <div className="video-chip-list">
                          {rawItem.post.videos.map((video) => (
                            <span className="tag" key={video.id}>
                              {video.type} · {video.sourcePlatform || "未知平台"}{video.fileSizeBytes ? ` · ${formatBytes(video.fileSizeBytes)}` : ""}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="job-error">此原始条目尚未生成文章。</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </AdminShell>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric-card">
      <div style={{ fontSize: 24, fontWeight: 600, fontFamily: "var(--font-display)" }}>{value}</div>
      <div className="muted" style={{ fontSize: 13 }}>{label}</div>
    </div>
  );
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="diagnostic-item">
      <span>{label}</span>
      <strong className={mono ? "mono-value" : undefined}>{value}</strong>
    </div>
  );
}
