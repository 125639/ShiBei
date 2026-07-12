import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { prisma } from "@/lib/prisma";
import { getAppMode } from "@/lib/app-mode";
import {
  MAX_SYNC_JSON_BYTES,
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
  const { since = null, includeLocalFiles = false } = opts;
  // Capture a stable upper bound before reading. Importers use this exact value
  // as their next cursor, so rows changed during the query fall into the next run.
  const exportedAt = new Date();

  const posts = await prisma.post.findMany({
    where: {
      status: "PUBLISHED",
      updatedAt: { ...(since ? { gt: since } : {}), lte: exportedAt },
    },
    include: {
      tags: true,
      topics: { select: { name: true, slug: true } },
      videos: true,
    },
    orderBy: { updatedAt: "asc" },
  });

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
          post: { is: { status: "PUBLISHED" } }
        }
      })
    : [];
  const allVideos = [...new Map(
    [...posts.flatMap((post) => post.videos), ...changedVideos].map((video) => [video.id, video])
  ).values()];
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
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"));
  zip.addFile("posts.json", Buffer.from(JSON.stringify(postPayloads, null, 2), "utf-8"));
  zip.addFile("videos.json", Buffer.from(JSON.stringify(videoPayloads, null, 2), "utf-8"));

  if (includeLocalFiles) {
    const publicDir = path.resolve(process.cwd(), "public");
    const uploadsRoot = path.resolve(publicDir, "uploads");
    const seenInZip = new Set<string>();
    for (const video of videoPayloads) {
      if (!video.localPath) continue;
      const relInsideUploads = video.localPath.replace(/^\/+/, ""); // e.g. "uploads/video/abc.mp4"
      if (!relInsideUploads.startsWith("uploads/")) continue; // 仅打包 public/uploads 下的文件
      const abs = path.resolve(publicDir, relInsideUploads);
      // 安全:确保解析后的绝对路径仍然落在 uploadsRoot 内,防止 localPath 被恶意写为
      // "uploads/../../etc/passwd" 之类绕过沙盒。
      if (!abs.startsWith(uploadsRoot + path.sep)) continue;
      if (seenInZip.has(relInsideUploads)) continue;
      try {
        const stat = await fs.stat(abs);
        if (!stat.isFile()) continue; // 拒绝 symlink-to-dir 或其他特殊文件
        const buf = await fs.readFile(abs);
        zip.addFile(relInsideUploads, buf);
        seenInZip.add(relInsideUploads);
      } catch {
        // 文件丢失/不可读不影响整体导出，只跳过该文件。
        // 导入端会得到一条 LOCAL Video 记录但无文件，会自动降级为不可播放/链接。
      }
    }
  }

  // 写入更新最新导出时间(失败不影响导出本身)。
  try {
    await prisma.syncState.upsert({
      where: { id: "sync" },
      create: { id: "sync", lastExportedAt: new Date(), updatedAt: new Date() },
      update: { lastExportedAt: new Date() },
    });
  } catch {
    // ignore
  }

  return zip.toBuffer();
}

// 解析 ZIP 为内存中的 SyncBundle，import.ts 复用。
export function parseSyncZip(buffer: Buffer): { bundle: SyncBundle; zip: AdmZip } {
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
  return { bundle: { manifest, posts, videos }, zip };
}

function zipEntrySize(entry: { header?: { size?: number } }) {
  const size = Number(entry.header?.size || 0);
  return Number.isFinite(size) && size > 0 ? size : 0;
}
