import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { AutoRefresh } from "@/components/AutoRefresh";
import { I18nText } from "@/components/I18nText";
import { MetricCard } from "@/components/MetricCard";
import { SubmitButton } from "@/components/SubmitButton";
import { TaskProgress } from "@/components/TaskProgress";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, getJobDuration, getJobKindLabel, getJobTitleLabel } from "@/lib/job-utils";
import { decodePostRepairResult, parsePostRepairUrl, type PostRepairResult } from "@/lib/post-repair";
import { BUNDLED_STYLE_PRESETS } from "@/lib/content-style";
import { parseKeywordResearchUrl, parseRawItemKeywordUrl, researchDepthLabel, researchScopeLabel } from "@/lib/research";
import { prisma } from "@/lib/prisma";
import { formatBytes } from "@/lib/storage";

// 来源 URL / 原始条目 URL 对关键词研究任务来说是内部伪 URL
// （keyword://research?q=...），直接展示是一串没人看得懂的编码垃圾。
// 能解析出关键词就还原成一句人话；不是关键词研究（比如真实网页/RSS
// 链接）就原样展示，那本身就是有意义的信息。
function friendlySourceLabel(sourceUrl: string) {
  const keywordResearch = parseKeywordResearchUrl(sourceUrl);
  if (keywordResearch) {
    return `关键词搜索：${keywordResearch.keyword}（${researchScopeLabel(keywordResearch.scope)} · ${keywordResearch.count} 篇 · ${researchDepthLabel(keywordResearch.depth)}）`;
  }
  const rawItemKeyword = parseRawItemKeywordUrl(sourceUrl);
  if (rawItemKeyword) return `关键词：${rawItemKeyword.keyword}`;
  return sourceUrl;
}

export const dynamic = "force-dynamic";

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
  const postRepair = parsePostRepairUrl(job.sourceUrl);
  const repairResult = decodePostRepairResult(job.error);

  // job.modelConfigId/contentStyleId 只是裸字符串外键，schema 里没声明
  // Prisma relation（历史遗留：一个还可能指向内置预设而非表行），得单独查。
  const [modelConfigRow, contentStyleRow] = await Promise.all([
    job.modelConfigId
      ? prisma.modelConfig.findUnique({ where: { id: job.modelConfigId }, select: { name: true } })
      : null,
    job.contentStyleId
      ? prisma.contentStyle.findUnique({ where: { id: job.contentStyleId }, select: { name: true } })
      : null
  ]);
  const bundledStylePreset = job.contentStyleId
    ? BUNDLED_STYLE_PRESETS.find((preset) => preset.id === job.contentStyleId)
    : null;
  const modelConfigLabel = job.modelConfigId ? modelConfigRow?.name || job.modelConfigId : "默认 / default";
  const contentStyleLabel = job.contentStyleId
    ? contentStyleRow?.name || bundledStylePreset?.name || job.contentStyleId
    : "默认 / default";

  const rawItemsWithPosts = job.rawItems.filter((item) => item.post);
  const videos = rawItemsWithPosts.flatMap((item) => item.post?.videos || []);
  const localVideos = videos.filter((video) => video.type === "LOCAL");
  const totalLocalBytes = localVideos.reduce((sum, video) => sum + (video.fileSizeBytes || 0), 0);

  return (
    <AdminShell>
      <AutoRefresh active={job.status === "QUEUED" || job.status === "RUNNING"} />
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">Job Detail</p>
          <h1>{getJobTitleLabel(job)}</h1>
          <div className="meta-row">
            <span className={statusClass(job.status)}>{job.status}</span>
            <span className="tag">{getJobKindLabel(job)}</span>
            {job.source ? <span className="tag">{job.source.name}</span> : null}
          </div>
        </div>
        <div className="admin-page-actions">
          <Link className="button secondary" href="/admin/jobs"><I18nText zh="任务列表" en="All Jobs" /></Link>
          {postRepair ? (
            <Link className="button" href={`/admin/posts/${postRepair.postId}`}><I18nText zh="打开对应文章" en="Open post" /></Link>
          ) : <form action="/api/admin/run" method="post">
            {job.sourceId ? (
              <input type="hidden" name="sourceId" value={job.sourceId} />
            ) : (
              <>
                <input type="hidden" name="tempUrl" value={job.sourceUrl} />
                <input type="hidden" name="tempType" value={job.sourceType} />
              </>
            )}
            {job.contentStyleId ? <input type="hidden" name="contentStyleId" value={job.contentStyleId} /> : null}
            <SubmitButton pendingLabel={<I18nText zh="提交中…" en="Submitting…" />}><I18nText zh="重跑任务" en="Re-run Job" /></SubmitButton>
          </form>}
        </div>
      </div>

      <div className="admin-grid-3">
        <MetricCard label={<I18nText zh="原始条目" en="Raw items" />} value={job.rawItems.length} />
        <MetricCard label={<I18nText zh="生成文章" en="Posts created" />} value={rawItemsWithPosts.length} />
        <MetricCard label={<I18nText zh="本地视频" en="Local videos" />} value={`${localVideos.length} / ${formatBytes(totalLocalBytes)}`} />
      </div>

      <section className="admin-panel" style={{ marginTop: 24 }} aria-live="polite">
        <TaskProgress
          label="任务执行进度"
          stage={job.status === "QUEUED"
            ? "等待 worker 接手"
            : job.status === "RUNNING"
              ? postRepair ? "正在按审核意见返修并重复发布检查" : "正在采集来源、生成内容并执行最多 3 轮自动返修"
              : job.status === "COMPLETED"
                ? "任务已完成"
                : "任务已结束，请查看错误信息"}
          value={job.status === "COMPLETED" || job.status === "FAILED" ? 1 : undefined}
          max={1}
          active={job.status === "QUEUED" || job.status === "RUNNING"}
        />
      </section>

      <section className="admin-panel" style={{ marginTop: 24 }}>
        <h2><I18nText zh="执行信息" en="Execution Info" /></h2>
        <div className="diagnostic-grid">
          <Info label={<I18nText zh="任务 ID" en="Job ID" />} value={job.id} mono />
          <Info label={<I18nText zh="来源 URL" en="Source URL" />} value={friendlySourceLabel(job.sourceUrl)} />
          <Info label={<I18nText zh="来源类型" en="Source type" />} value={job.sourceType} />
          <Info label={<I18nText zh="创建时间" en="Created" />} value={formatDateTime(job.createdAt)} />
          <Info label={<I18nText zh="更新时间" en="Updated" />} value={formatDateTime(job.updatedAt)} />
          <Info label={<I18nText zh="完成时间" en="Completed" />} value={formatDateTime(job.completedAt)} />
          <Info label={<I18nText zh="耗时" en="Duration" />} value={getJobDuration(job)} />
          <Info label={<I18nText zh="模型配置" en="Model config" />} value={modelConfigLabel} />
          <Info label={<I18nText zh="内容风格" en="Content style" />} value={contentStyleLabel} />
          <Info label={<I18nText zh="自动主题" en="Topic" />} value={job.contentTopic?.name || "—"} />
        </div>
        {repairResult ? (
          <RepairExecutionResult result={repairResult} />
        ) : job.error ? (
          <div className="diagnostic-error">
            <strong><I18nText zh="错误信息" en="Error" /></strong>
            <pre>{job.error}</pre>
          </div>
        ) : null}
      </section>

      <section className="admin-panel" style={{ marginTop: 24 }}>
        <h2><I18nText zh="产物" en="Artifacts" /></h2>
        {job.rawItems.length === 0 ? (
          <p className="muted">
            {postRepair
              ? <I18nText zh="文章返修直接使用原文章关联的证据，不会复制新的原始条目。完整结果见上方执行信息。" en="Post repair reuses the post's trusted evidence and does not duplicate raw items. See the execution result above." />
              : <I18nText zh="还没有原始条目。若任务已失败，优先查看上方错误信息。" en="No raw items yet. If the job failed, check the error above first." />}
          </p>
        ) : (
          <div className="table-list">
            {job.rawItems.map((rawItem) => (
              <div className="table-item job-artifact" key={rawItem.id}>
                <div>
                  <strong>{rawItem.title}</strong>
                  <div className="muted">
                    <I18nText zh="原始条目：" en="Raw item: " /><code>{rawItem.id}</code> · <I18nText zh="创建" en="created" /> {formatDateTime(rawItem.createdAt)}
                  </div>
                  <div className="muted">{shortText(friendlySourceLabel(rawItem.url), 220)}</div>
                  {rawItem.post ? (
                    <div className="artifact-post">
                      <div className="meta-row" style={{ alignItems: "center" }}>
                        <span className="tag">{rawItem.post.status}</span>
                        <strong>{rawItem.post.title}</strong>
                      </div>
                      <p className="muted">{shortText(rawItem.post.summary, 220)}</p>
                      <div className="meta-row">
                        <Link className="text-link" href={`/admin/posts/${rawItem.post.id}`}><I18nText zh="编辑文章" en="Edit post" /></Link>
                        <Link className="text-link" href={`/posts/${rawItem.post.slug}`}><I18nText zh="查看前台" en="View live" /></Link>
                        {rawItem.post.videos.length ? <span><I18nText zh="视频" en="videos" /> {rawItem.post.videos.length}</span> : null}
                        {rawItem.post.tags.length ? <span><I18nText zh="标签" en="tags" /> {rawItem.post.tags.map((tag) => tag.name).join(" / ")}</span> : null}
                      </div>
                      {rawItem.post.videos.length ? (
                        <div className="video-chip-list">
                          {rawItem.post.videos.map((video) => (
                            <span className="tag" key={video.id}>
                              {video.type} · {video.sourcePlatform || "—"}{video.fileSizeBytes ? ` · ${formatBytes(video.fileSizeBytes)}` : ""}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="job-error"><I18nText zh="此原始条目尚未生成文章。" en="No post generated from this raw item yet." /></p>
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

function RepairExecutionResult({ result }: { result: PostRepairResult }) {
  return (
    <div className={`diagnostic-result${result.state === "FAILED" ? " is-failed" : ""}`}>
      <strong>AI 发布审核结果：{result.state === "PUBLISHED" ? "已通过并发布" : result.state === "FAILED" ? "未通过" : "执行中"}</strong>
      <p>{result.message}</p>
      {result.reason ? <p><strong>最终审核意见：</strong>{result.reason}</p> : null}
      {result.guidance ? <p><strong>下一步：</strong>{result.guidance}</p> : null}
      {result.rounds.length ? (
        <ol>
          {result.rounds.map((round) => (
            <li key={`${round.round}-${round.action}`}>
              第 {round.round} 轮{round.action === "regenerate" ? "重新生成" : "定向返修"}：{round.reason}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function Info({ label, value, mono = false }: { label: React.ReactNode; value: string; mono?: boolean }) {
  return (
    <div className="diagnostic-item">
      <span>{label}</span>
      <strong className={mono ? "mono-value" : undefined}>{value}</strong>
    </div>
  );
}
