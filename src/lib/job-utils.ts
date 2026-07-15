import { parseKeywordResearchUrl, researchScopeLabel } from "@/lib/research";
import { parsePostRepairUrl } from "@/lib/post-repair";

/**
 * FetchJob 展示层的共享工具。
 * 列表页与详情页 include 的关联不同，这里用结构化最小字段约束，
 * 两边的 Prisma payload 都能直接传入。
 */
type JobTimeFields = {
  status: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

type JobLabelFields = {
  sourceUrl: string;
  sourceType: string;
  contentTopic?: { name: string } | null;
  source?: { name: string } | null;
};

export function formatDateTime(value: Date | null | undefined) {
  if (!value) return "—";
  return value.toLocaleString("zh-CN");
}

export function getJobDuration(job: JobTimeFields) {
  const end = job.completedAt || (job.status === "RUNNING" ? new Date() : job.updatedAt);
  const seconds = Math.max(0, Math.round((end.getTime() - job.createdAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`;
  return `${(seconds / 3600).toFixed(1)} 小时`;
}

export function getJobTitleLabel(job: JobLabelFields) {
  const keywordResearch = parseKeywordResearchUrl(job.sourceUrl);
  if (keywordResearch) return `关键词生成：${keywordResearch.keyword}`;
  const postRepair = parsePostRepairUrl(job.sourceUrl);
  if (postRepair) return `文章自动返修：${postRepair.postId}`;
  return job.contentTopic?.name || job.source?.name || job.sourceUrl;
}

export function getJobKindLabel(job: JobLabelFields) {
  const keywordResearch = parseKeywordResearchUrl(job.sourceUrl);
  if (keywordResearch) {
    return `关键词研究 · ${researchScopeLabel(keywordResearch.scope)} · ${keywordResearch.count} 篇 · ${keywordResearch.depth}`;
  }
  if (parsePostRepairUrl(job.sourceUrl)) return "AI 发布审核 · 最多 3 轮返修";
  return job.sourceType;
}
