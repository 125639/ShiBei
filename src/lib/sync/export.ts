import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { prisma } from "@/lib/prisma";
import { getAppMode } from "@/lib/app-mode";
import {
  MAX_SYNC_JSON_BYTES,
  MAX_SYNC_FILE_ENTRIES,
  MAX_SYNC_SINGLE_FILE_BYTES,
  MAX_SYNC_TOTAL_FILE_BYTES,
  MAX_SYNC_ZIP_BYTES,
  MAX_SYNC_POSTS,
  MAX_SYNC_VIDEOS
} from "./limits";
import {
  SYNC_SCHEMA_VERSION,
  type SyncBundle,
  type SyncManifest,
  type SyncPostPayload,
  type SyncVideoPayload,
} from "./types";

export type ExportOptions = {
  /** 仅导出 updatedAt 严格大于此时间的文章；不传则全量导出。 */
  since?: Date | null;
  /** 是否包含本地视频文件。默认 false，避免自动同步时大 ZIP 压垮低配前端。 */
  includeLocalFiles?: boolean;
  /**
   * 是否推进 SyncState.lastExportedAt（后台「下载增量 ZIP」的起点）。
   * sync-worker 的自动拉取每分钟都会触发导出，若同样推进该游标，管理员手动
   * 下载的「增量 ZIP」窗口就只剩最近一分钟、几乎恒为空包。因此机机拉取
   * （Bearer 鉴权）应传 false，仅管理员亲自导出时推进。
   */
  advanceCursor?: boolean;
};

/**
 * 把数据库中已发布(PUBLISHED)的文章 + 关联视频 打包为 ZIP Buffer。
 * ZIP 结构:
 *   manifest.json
 *   posts.json
 *   videos.json
 *   uploads/video/<filename>   (LOCAL 视频的物理文件，按 video.localPath 命名)
 */
export async function exportToZip(opts: ExportOptions = {}): Promise<Buffer> {
  const { since = null, includeLocalFiles = false, advanceCursor = true } = opts;
  // Capture a stable upper bound before reading. Importers use this exact value
  // as their next cursor, so rows changed during the query fall into the next run.
  const exportedAt = new Date();

  const posts = await prisma.post.findMany({
    where: {
      status: "PUBLISHED",
      publicationBlockedReason: null,
      updatedAt: { ...(since ? { gt: since } : {}), lte: exportedAt },
    },
    include: {
      tags: true,
      topics: { select: { name: true, slug: true } },
      videos: true,
    },
    orderBy: { updatedAt: "asc" },
    take: MAX_SYNC_POSTS + 1,
  });
  if (posts.length > MAX_SYNC_POSTS) {
    throw new Error(`导出文章数量超过上限 ${MAX_SYNC_POSTS}，请使用增量导出`);
  }

  const postPayloads: SyncPostPayload[] = posts.map((post) => ({
    id: post.id,
    slug: post.slug,
    title: post.title,
    titleEn: post.titleEn,
    summary: post.summary,
    summaryEn: post.summaryEn,
    content: post.content,
    contentEn: post.contentEn,
    status: post.status,
    kind: post.kind,
    sourceUrl: post.sourceUrl,
    sortOrder: post.sortOrder,
    translatedAt: post.translatedAt ? post.translatedAt.toISOString() : null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
    tags: post.tags.map((t) => ({ name: t.name })),
    topics: post.topics.map((t) => ({ name: t.name, slug: t.slug })),
  }));

  // 新文章要携带全部关联视频；已有文章的视频若单独更新，也必须进入增量包。
  const changedVideos = since
    ? await prisma.video.findMany({
        where: {
          updatedAt: { gt: since, lte: exportedAt },
          post: { is: { status: "PUBLISHED", publicationBlockedReason: null } }
        }
      })
    : [];
  const allVideos = [...new Map(
    [...posts.flatMap((post) => post.videos), ...changedVideos].map((video) => [video.id, video])
  ).values()];
  if (allVideos.length > MAX_SYNC_VIDEOS) {
    throw new Error(`导出视频数量超过上限 ${MAX_SYNC_VIDEOS}，请使用增量导出`);
  }
  const videoPayloads: SyncVideoPayload[] = allVideos.map((video) => ({
    id: video.id,
    title: video.title,
    type: video.type,
    url: video.url,
    coverUrl: video.coverUrl,
    summary: video.summary,
    displayMode: ((video as { displayMode?: string | null }).displayMode === "link" ? "link" : "embed"),
    sortOrder: video.sortOrder,
    durationSec: video.durationSec,
    region: video.region,
    sourcePlatform: video.sourcePlatform,
    sourcePageUrl: video.sourcePageUrl,
    localPath: video.localPath,
    fileSizeBytes: video.fileSizeBytes,
    attribution: video.attribution,
    postId: video.postId,
    createdAt: video.createdAt.toISOString(),
    updatedAt: video.updatedAt.toISOString(),
  }));

  const manifest: SyncManifest = {
    schemaVersion: SYNC_SCHEMA_VERSION,
    exportedAt: exportedAt.toISOString(),
    since: since ? since.toISOString() : null,
    postCount: postPayloads.length,
    videoCount: videoPayloads.length,
    exporterMode: getAppMode(),
  };

  const zip = new AdmZip();
  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), "utf-8");
  const postsBuffer = Buffer.from(JSON.stringify(postPayloads, null, 2), "utf-8");
  const videosBuffer = Buffer.from(JSON.stringify(videoPayloads, null, 2), "utf-8");
  for (const [name, data] of [["manifest.json", manifestBuffer], ["posts.json", postsBuffer], ["videos.json", videosBuffer]] as const) {
    if (data.byteLength > MAX_SYNC_JSON_BYTES) {
      throw new Error(`${name} 超过 ${Math.round(MAX_SYNC_JSON_BYTES / 1024 / 1024)}MB，请使用增量导出`);
    }
    zip.addFile(name, data);
  }

  if (includeLocalFiles) {
    const publicDir = path.resolve(process.cwd(), "public");
    const uploadsRoot = path.resolve(publicDir, "uploads");
    const seenInZip = new Set<string>();
    const jsonBytes = manifestBuffer.byteLength + postsBuffer.byteLength + videosBuffer.byteLength;
    const maxLocalBytes = Math.min(
      MAX_SYNC_TOTAL_FILE_BYTES,
      Math.max(0, MAX_SYNC_ZIP_BYTES - jsonBytes - 1024 * 1024)
    );
    let localBytes = 0;
    for (const video of videoPayloads) {
      if (!video.localPath) continue;
      const relInsideUploads = video.localPath.replace(/^\/+/, ""); // e.g. "uploads/video/abc.mp4"
      if (!/^uploads\/video\/[A-Za-z0-9._-]+$/.test(relInsideUploads)) continue;
      const abs = path.resolve(publicDir, relInsideUploads);
      // 安全:确保解析后的绝对路径仍然落在 uploadsRoot 内,防止 localPath 被恶意写为
      // "uploads/../../etc/passwd" 之类绕过沙盒。
      if (!abs.startsWith(uploadsRoot + path.sep)) continue;
      if (seenInZip.has(relInsideUploads)) continue;
      try {
        const stat = await fs.lstat(abs);
        // Never follow a symlink inside uploads: otherwise a local symlink to
        // /etc or another tenant could be exfiltrated into the archive.
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        if (stat.size > MAX_SYNC_SINGLE_FILE_BYTES) {
          throw new Error(`本地视频 ${relInsideUploads} 超过单文件同步上限`);
        }
        if (localBytes + stat.size > maxLocalBytes) {
          throw new Error("本地视频总量超过当前部署的同步 ZIP 上限，请关闭文件打包或使用增量导出");
        }
        const buf = await fs.readFile(abs);
        if (buf.byteLength !== stat.size) throw new Error(`读取 ${relInsideUploads} 时文件发生变化，请重试`);
        zip.addFile(relInsideUploads, buf);
        seenInZip.add(relInsideUploads);
        localBytes += buf.byteLength;
      } catch (error) {
        if (error instanceof Error && /超过|发生变化/.test(error.message)) throw error;
        // A missing/unreadable file does not invalidate metadata-only sync.
      }
    }
  }

  const buffer = zip.toBuffer();
  if (buffer.byteLength > MAX_SYNC_ZIP_BYTES) {
    throw new Error(`同步 ZIP 超过 ${Math.round(MAX_SYNC_ZIP_BYTES / 1024 / 1024)}MB 上限，请使用增量导出`);
  }

  // Advance the displayed export cursor only after the archive has actually
  // been materialized successfully. A toBuffer/OOM/limit failure must never
  // make the next incremental export skip rows that were not delivered.
  if (advanceCursor) {
    try {
      await prisma.syncState.upsert({
        where: { id: "sync" },
        create: { id: "sync", lastExportedAt: exportedAt, updatedAt: new Date() },
        update: { lastExportedAt: exportedAt },
      });
    } catch {
      // ignore
    }
  }

  return buffer;
}

// 解析 ZIP 为内存中的 SyncBundle，import.ts 复用。
export function parseSyncZip(buffer: Buffer): { bundle: SyncBundle; zip: AdmZip } {
  if (buffer.byteLength > MAX_SYNC_ZIP_BYTES) {
    throw new Error(`同步 ZIP 超过 ${Math.round(MAX_SYNC_ZIP_BYTES / 1024 / 1024)}MB 上限`);
  }
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch (err) {
    throw new Error(`无法解析 ZIP 文件: ${err instanceof Error ? err.message : String(err)}`);
  }
  const manifestEntry = zip.getEntry("manifest.json");
  const postsEntry = zip.getEntry("posts.json");
  const videosEntry = zip.getEntry("videos.json");
  if (!manifestEntry || !postsEntry || !videosEntry) {
    throw new Error("ZIP 缺少 manifest/posts/videos 之一");
  }
  const entries = zip.getEntries();
  const names = new Set<string>();
  let uploadEntries = 0;
  let declaredUploadBytes = 0;
  for (const entry of entries) {
    if (names.has(entry.entryName)) throw new Error(`ZIP 包含重复条目: ${entry.entryName}`);
    names.add(entry.entryName);
    if (entry.isDirectory) continue;
    const knownJson = entry.entryName === "manifest.json" || entry.entryName === "posts.json" || entry.entryName === "videos.json";
    if (!knownJson && !entry.entryName.startsWith("uploads/")) {
      throw new Error(`ZIP 包含不允许的条目: ${entry.entryName}`);
    }
    const size = zipEntrySize(entry);
    const compressedSize = Number((entry as { header?: { compressedSize?: number } }).header?.compressedSize || 0);
    if (size > 1024 * 1024 && compressedSize > 0 && size / compressedSize > 1000) {
      throw new Error(`ZIP 条目压缩比异常，疑似解压炸弹: ${entry.entryName}`);
    }
    if (entry.entryName.startsWith("uploads/")) {
      uploadEntries += 1;
      if (uploadEntries > MAX_SYNC_FILE_ENTRIES) throw new Error(`ZIP 内 uploads 文件数量超过上限 ${MAX_SYNC_FILE_ENTRIES}`);
      if (size > MAX_SYNC_SINGLE_FILE_BYTES) throw new Error(`ZIP 内文件超过单文件上限: ${entry.entryName}`);
      declaredUploadBytes += size;
      if (declaredUploadBytes > MAX_SYNC_TOTAL_FILE_BYTES) throw new Error("ZIP 解压后总文件体积超过上限");
    }
  }
  for (const entry of [manifestEntry, postsEntry, videosEntry]) {
    const size = zipEntrySize(entry);
    if (size > MAX_SYNC_JSON_BYTES) {
      throw new Error(`${entry.entryName} 超过 ${Math.round(MAX_SYNC_JSON_BYTES / 1024 / 1024)}MB，已拒绝导入`);
    }
  }
  let manifest: SyncManifest;
  let posts: SyncPostPayload[];
  let videos: SyncVideoPayload[];
  try {
    manifest = JSON.parse(manifestEntry.getData().toString("utf-8")) as SyncManifest;
    posts = JSON.parse(postsEntry.getData().toString("utf-8")) as SyncPostPayload[];
    videos = JSON.parse(videosEntry.getData().toString("utf-8")) as SyncVideoPayload[];
  } catch (err) {
    throw new Error(`ZIP 内 JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!manifest || typeof manifest.schemaVersion !== "number") {
    throw new Error("ZIP manifest 格式不正确");
  }
  if (!manifest.exportedAt || Number.isNaN(new Date(manifest.exportedAt).getTime())) {
    throw new Error("ZIP manifest 的 exportedAt 不是合法 ISO 时间");
  }
  const exportedAt = new Date(manifest.exportedAt);
  if (exportedAt.getTime() > Date.now() + 10 * 60 * 1000) {
    throw new Error("ZIP manifest 的 exportedAt 来自未来，拒绝推进同步水位");
  }
  if (manifest.since !== null && manifest.since !== undefined) {
    const since = new Date(manifest.since);
    if (Number.isNaN(since.getTime()) || since > exportedAt) {
      throw new Error("ZIP manifest 的 since 时间无效");
    }
  }
  if (manifest.schemaVersion !== SYNC_SCHEMA_VERSION) {
    throw new Error(
      `同步包的 schemaVersion ${manifest.schemaVersion} 与本端 ${SYNC_SCHEMA_VERSION} 不兼容。请升级一端再同步。`
    );
  }
  if (!Array.isArray(posts) || !Array.isArray(videos)) {
    throw new Error("ZIP 内 posts / videos 不是数组");
  }
  if (posts.length > MAX_SYNC_POSTS) {
    throw new Error(`ZIP 内 posts 数量超过上限 ${MAX_SYNC_POSTS}`);
  }
  if (videos.length > MAX_SYNC_VIDEOS) {
    throw new Error(`ZIP 内 videos 数量超过上限 ${MAX_SYNC_VIDEOS}`);
  }
  if (manifest.postCount !== posts.length || manifest.videoCount !== videos.length) {
    throw new Error("ZIP manifest 的记录数量与内容不一致");
  }
  return { bundle: { manifest, posts, videos }, zip };
}

function zipEntrySize(entry: { header?: { size?: number } }) {
  const size = Number(entry.header?.size || 0);
  return Number.isFinite(size) && size > 0 ? size : 0;
}
