import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "./prisma";
import { resolveUploadsPath } from "./uploads-path";

const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");
export const IMAGE_DIR = path.join(UPLOAD_ROOT, "image");
export const MUSIC_DIR = path.join(UPLOAD_ROOT, "music");
export const VIDEO_DIR = path.join(UPLOAD_ROOT, "video");

export async function ensureUploadDirs() {
  await fs.mkdir(IMAGE_DIR, { recursive: true });
  await fs.mkdir(MUSIC_DIR, { recursive: true });
  await fs.mkdir(VIDEO_DIR, { recursive: true });
}

export async function dirSizeBytes(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += await dirSizeBytes(full);
      } else if (entry.isFile()) {
        const stat = await fs.stat(full);
        total += stat.size;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

export type StorageReport = {
  uploadsBytes: number;
  imageBytes: number;
  musicBytes: number;
  videoBytes: number;
  postCount: number;
  rawItemCount: number;
  videoCount: number;
  fetchJobCount: number;
  maxStorageMb: number;
  textOnlyMode: boolean;
  cleanupAfterDays: number;
  approxDbBytesEstimate: number;
};

export async function reportStorage(): Promise<StorageReport> {
  await ensureUploadDirs();
  const [imageBytes, musicBytes, videoBytes, settings, postCount, rawItemCount, videoCount, fetchJobCount] =
    await Promise.all([
      dirSizeBytes(IMAGE_DIR),
      dirSizeBytes(MUSIC_DIR),
      dirSizeBytes(VIDEO_DIR),
      prisma.siteSettings.findUnique({ where: { id: "site" } }),
      prisma.post.count(),
      prisma.rawItem.count(),
      prisma.video.count(),
      prisma.fetchJob.count()
    ]);

  // Rough DB-side estimate: each row ~3KB on average for our content-heavy tables.
  const approxDbBytesEstimate = postCount * 6000 + rawItemCount * 3000 + fetchJobCount * 1000 + videoCount * 1200;

  return {
    uploadsBytes: imageBytes + musicBytes + videoBytes,
    imageBytes,
    musicBytes,
    videoBytes,
    postCount,
    rawItemCount,
    videoCount,
    fetchJobCount,
    maxStorageMb: (settings as { maxStorageMb?: number })?.maxStorageMb ?? 2048,
    textOnlyMode: (settings as { textOnlyMode?: boolean })?.textOnlyMode ?? false,
    cleanupAfterDays: (settings as { cleanupAfterDays?: number })?.cleanupAfterDays ?? 30,
    approxDbBytesEstimate
  };
}

export type CleanupSummary = {
  cleaned: boolean;
  reason: string;
  fetchJobsDeleted: number;
  rawItemsDeleted: number;
  archivedPosts: number;
  videoFilesDeleted: number;
  bytesFreed: number;
};

export async function runStorageCleanup(opts?: { force?: boolean; daysOverride?: number }): Promise<CleanupSummary> {
  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
  const days = opts?.daysOverride ?? (settings as { cleanupAfterDays?: number })?.cleanupAfterDays ?? 30;
  const maxMb = (settings as { maxStorageMb?: number })?.maxStorageMb ?? 2048;

  const before = await dirSizeBytes(UPLOAD_ROOT);
  const totalBytes = before;
  const overQuota = totalBytes > maxMb * 1024 * 1024;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Always delete completed FetchJobs older than cutoff (rawItems referencing them are kept via SetNull,
  // but content can be safely shed once the post is archived).
  const fetchJobsDeleted = await prisma.fetchJob.deleteMany({
    where: { completedAt: { lt: cutoff } }
  }).then((r) => r.count).catch(() => 0);

  // Drop orphan RawItems (no post linked) older than cutoff to free DB space.
  const rawItemsDeleted = await prisma.rawItem.deleteMany({
    where: {
      createdAt: { lt: cutoff },
      post: null
    }
  }).then((r) => r.count).catch(() => 0);

  // Archive (do not delete) old PUBLISHED posts when over quota or when forced.
  let archivedPosts = 0;
  if (overQuota || opts?.force) {
    archivedPosts = await prisma.post.updateMany({
      where: { status: "PUBLISHED", createdAt: { lt: cutoff } },
      data: { status: "ARCHIVED" }
    }).then((r) => r.count).catch(() => 0);
  }

  // Delete local video files for ARCHIVED posts (we keep metadata).
  let videoFilesDeleted = 0;
  const videosToTrim = await (prisma as unknown as {
    video: {
      findMany: (args: unknown) => Promise<Array<{ id: string; localPath: string | null; postId: string | null }>>;
      update: (args: unknown) => Promise<unknown>;
    };
  }).video.findMany({
    where: {
      localPath: { not: null },
      post: { status: "ARCHIVED" }
    },
    select: { id: true, localPath: true, postId: true }
  }).catch(() => [] as Array<{ id: string; localPath: string | null; postId: string | null }>);

  for (const video of videosToTrim) {
    if (!video.localPath) continue;
    // 安全:必须落在 public/uploads 内,防止 DB 中被恶意写入 ../etc/passwd
    // 而把 fs.unlink 变成任意删文件的原语。
    const abs = resolveUploadsPath(video.localPath);
    if (!abs) continue;
    try {
      await fs.unlink(abs);
      videoFilesDeleted += 1;
      await (prisma as unknown as {
        video: { update: (args: unknown) => Promise<unknown> };
      }).video.update({
        where: { id: video.id },
        data: { localPath: null, fileSizeBytes: null }
      });
    } catch {
      // file may already be missing; ignore
    }
  }

  const after = await dirSizeBytes(UPLOAD_ROOT);
  return {
    cleaned: true,
    reason: overQuota ? "over-quota" : "scheduled",
    fetchJobsDeleted,
    rawItemsDeleted,
    archivedPosts,
    videoFilesDeleted,
    bytesFreed: Math.max(0, before - after)
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
