import fs from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  completedStandaloneJobRetentionWhere,
  normalizeCleanupRetentionDays,
  shouldArchiveOldPosts,
  shouldRunStorageCleanup,
  type StorageCleanupTrigger
} from "./storage-cleanup-policy";
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
      prisma.siteSettings.findUnique({
        where: { id: "site" },
        select: { maxStorageMb: true, textOnlyMode: true, cleanupAfterDays: true }
      }),
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

type CleanupCount = { count: number };

export type StorageCleanupDatabase = {
  siteSettings: {
    findUnique: (args: Prisma.SiteSettingsFindUniqueArgs) => Promise<{
      cleanupAfterDays: number;
      cleanupCustomEnabled: boolean;
      maxStorageMb: number;
    } | null>;
  };
  fetchJob: { deleteMany: (args: Prisma.FetchJobDeleteManyArgs) => Promise<CleanupCount> };
  rawItem: { deleteMany: (args: Prisma.RawItemDeleteManyArgs) => Promise<CleanupCount> };
  post: { updateMany: (args: Prisma.PostUpdateManyArgs) => Promise<CleanupCount> };
  video: {
    findMany: (args: Prisma.VideoFindManyArgs) => Promise<Array<{ id: string; localPath: string | null; postId: string | null }>>;
    update: (args: Prisma.VideoUpdateArgs) => Promise<unknown>;
  };
};

export type StorageCleanupDependencies = {
  database?: StorageCleanupDatabase;
  dirSize?: (dir: string) => Promise<number>;
  unlinkFile?: (file: string) => Promise<void>;
  resolveLocalPath?: (localPath: string | null | undefined) => string | null;
  now?: () => number;
};

export async function runStorageCleanup(
  opts?: {
    trigger?: StorageCleanupTrigger;
    /** @deprecated use trigger: "manual" */
    force?: boolean;
    daysOverride?: number;
  },
  dependencies: StorageCleanupDependencies = {}
): Promise<CleanupSummary> {
  const database = dependencies.database ?? (prisma as unknown as StorageCleanupDatabase);
  const settings = await database.siteSettings.findUnique({
    where: { id: "site" },
    select: { cleanupAfterDays: true, cleanupCustomEnabled: true, maxStorageMb: true }
  });
  const trigger: StorageCleanupTrigger = opts?.trigger ?? (opts?.force ? "manual" : "scheduled");
  const cleanupCustomEnabled = settings?.cleanupCustomEnabled === true;
  const emptySummary = (reason: string): CleanupSummary => ({
    cleaned: false,
    reason,
    fetchJobsDeleted: 0,
    rawItemsDeleted: 0,
    archivedPosts: 0,
    videoFilesDeleted: 0,
    bytesFreed: 0
  });

  if (!shouldRunStorageCleanup({ trigger, cleanupCustomEnabled })) {
    return emptySummary("automatic-cleanup-disabled");
  }

  const days = normalizeCleanupRetentionDays(opts?.daysOverride ?? settings?.cleanupAfterDays ?? 30);
  const maxMb = settings?.maxStorageMb ?? 2048;
  const sizeOf = dependencies.dirSize ?? dirSizeBytes;
  const now = dependencies.now?.() ?? Date.now();

  const before = await sizeOf(UPLOAD_ROOT);
  const totalBytes = before;
  const overQuota = totalBytes > maxMb * 1024 * 1024;
  const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);

  // Batch jobs are part of the durable AdminAiBatch audit/progress trail.
  // Failed and in-flight jobs remain available for diagnosis. Only old,
  // standalone successful jobs follow cleanupAfterDays.
  const fetchJobsDeleted = await database.fetchJob.deleteMany({
    where: completedStandaloneJobRetentionWhere(cutoff)
  }).then((r) => r.count);

  // Drop orphan RawItems (no post linked) older than cutoff to free DB space.
  const rawItemsDeleted = await database.rawItem.deleteMany({
    where: {
      createdAt: { lt: cutoff },
      post: null
    }
  }).then((r) => r.count);

  // Archive (do not delete) old PUBLISHED posts when over quota or when forced.
  let archivedPosts = 0;
  const reclaimOldPostStorage = shouldArchiveOldPosts({ trigger, overQuota });
  if (reclaimOldPostStorage) {
    archivedPosts = await database.post.updateMany({
      where: {
        status: "PUBLISHED",
        // Retention starts when readers could first see the article. An old
        // draft published recently must not be archived immediately merely
        // because its database row was created long ago.
        publishedAt: { lt: cutoff },
        pendingRevision: { equals: Prisma.DbNull }
      },
      data: { status: "ARCHIVED" }
    }).then((r) => r.count);
  }

  // Delete local video files for ARCHIVED posts (we keep metadata).
  let videoFilesDeleted = 0;
  const videosToTrim = reclaimOldPostStorage
    ? await database.video.findMany({
        where: {
          localPath: { not: null },
          // Keep videos for recently/manual-archived posts outside the configured
          // age window. The destructive rule is tied to cleanupAfterDays too.
          post: { status: "ARCHIVED", publishedAt: { lt: cutoff } }
      },
      select: { id: true, localPath: true, postId: true }
      })
    : [];

  const resolveLocalPath = dependencies.resolveLocalPath ?? resolveUploadsPath;
  const unlinkFile = dependencies.unlinkFile ?? fs.unlink;
  for (const video of videosToTrim) {
    if (!video.localPath) continue;
    // 安全:必须落在 public/uploads 内,防止 DB 中被恶意写入 ../etc/passwd
    // 而把 fs.unlink 变成任意删文件的原语。
    const abs = resolveLocalPath(video.localPath);
    if (!abs) continue;
    let deleted = false;
    try {
      await unlinkFile(abs);
      deleted = true;
    } catch (error) {
      // A stale DB pointer to an already-missing file is safe to heal. Permission,
      // I/O and database errors are not silently reported as a successful cleanup.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await database.video.update({
      where: { id: video.id },
      data: { localPath: null, fileSizeBytes: null }
    });
    if (deleted) videoFilesDeleted += 1;
  }

  const after = await sizeOf(UPLOAD_ROOT);
  return {
    cleaned: true,
    reason: trigger === "manual" ? "manual-forced" : overQuota ? "over-quota" : "scheduled-retention",
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
