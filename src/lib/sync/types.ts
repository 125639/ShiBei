// 前端 / 后端 / 完整版之间的同步数据契约。
// schemaVersion 用于将来不兼容变更时强制对方升级。

export const SYNC_SCHEMA_VERSION = 1;

export type SyncManifest = {
  schemaVersion: number;
  exportedAt: string; // ISO 8601
  since: string | null; // 增量起点；首次导出为 null
  postCount: number;
  videoCount: number;
  exporterMode: "frontend" | "backend" | "full";
};

export type SyncTagPayload = {
  name: string;
};

export type SyncTopicPayload = {
  name: string;
  slug: string;
};

export type SyncVideoPayload = {
  id: string;
  title: string;
  type: "LOCAL" | "EMBED" | "LINK";
  url: string;
  coverUrl: string | null;
  summary: string;
  displayMode: "embed" | "link";
  sortOrder: number;
  durationSec: number | null;
  region: "DOMESTIC" | "INTERNATIONAL" | "UNKNOWN";
  sourcePlatform: string | null;
  sourcePageUrl: string | null;
  // localPath:导出时是相对原仓库 public/ 的路径；导入端要将 ZIP 内的对应文件
  // 写到自己的 public/ 下同样路径。
  localPath: string | null;
  fileSizeBytes: number | null;
  attribution: string | null;
  postId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SyncPostPayload = {
  id: string;
  slug: string;
  title: string;
  titleEn: string | null;
  summary: string;
  summaryEn: string | null;
  content: string;
  contentEn: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  kind: "SINGLE_ARTICLE" | "DAILY_DIGEST" | "WEEKLY_ROUNDUP";
  sourceUrl: string | null;
  sortOrder: number;
  translatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  tags: SyncTagPayload[];
  topics: SyncTopicPayload[];
};

export type SyncBundle = {
  manifest: SyncManifest;
  posts: SyncPostPayload[];
  videos: SyncVideoPayload[];
};
