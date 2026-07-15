import fs from "node:fs/promises";
import path from "node:path";
import { VideoType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generationPublicationBlockReason } from "@/lib/publication-policy";
import { ensureUploadDirs } from "@/lib/storage";
import { parseSyncZip } from "./export";
import {
  MAX_SYNC_FILE_ENTRIES,
  MAX_SYNC_SINGLE_FILE_BYTES,
  MAX_SYNC_TOTAL_FILE_BYTES
} from "./limits";
import type { SyncBundle, SyncPostPayload, SyncVideoPayload } from "./types";

export type ImportResult = {
  postsUpserted: number;
  postsSkipped: number;
  videosUpserted: number;
  videosSkipped: number;
  filesWritten: number;
  filesSkipped: number;
  errors: string[];
};

/**
 * 把 ZIP 字节解析并 upsert 到本地 DB。
 * 冲突策略:incoming.updatedAt > existing.updatedAt 才覆盖；
 *           等于或更早 → skip（认为本地是更新版本）。
 */
export async function importFromZip(buffer: Buffer): Promise<ImportResult> {
  const { bundle, zip } = parseSyncZip(buffer);
  validateBundleBeforeWrite(bundle);
  const result: ImportResult = {
    postsUpserted: 0,
    postsSkipped: 0,
    videosUpserted: 0,
    videosSkipped: 0,
    filesWritten: 0,
    filesSkipped: 0,
    errors: [],
  };

  await ensureUploadDirs();

  // 1) 落盘视频本地文件
  const publicDir = path.resolve(process.cwd(), "public");
  const uploadsRoot = path.resolve(publicDir, "uploads");
  const payloadByLocalEntry = new Map<string, SyncVideoPayload>();
  for (const video of bundle.videos) {
    if (!video.localPath) continue;
    const rel = video.localPath.replace(/^\/+/, "");
    if (!/^uploads\/video\/[A-Za-z0-9._-]+$/.test(rel)) continue;
    if (payloadByLocalEntry.has(rel)) throw new Error(`多个视频引用同一同步文件: ${rel}`);
    payloadByLocalEntry.set(rel, video);
  }
  const existingVideos = bundle.videos.length
    ? await prisma.video.findMany({
        where: { id: { in: bundle.videos.map((video) => video.id) } },
        select: { id: true, updatedAt: true }
      })
    : [];
  const existingVideoById = new Map(existingVideos.map((video) => [video.id, video]));
  let fileEntries = 0;
  let totalFileBytes = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    if (!entry.entryName.startsWith("uploads/")) continue;
    const incomingVideo = payloadByLocalEntry.get(entry.entryName);
    if (!incomingVideo) {
      result.filesSkipped += 1;
      result.errors.push(`跳过未被视频记录引用的文件: ${entry.entryName}`);
      continue;
    }
    fileEntries += 1;
    if (fileEntries > MAX_SYNC_FILE_ENTRIES) {
      result.filesSkipped += 1;
      result.errors.push(`ZIP 内 uploads 文件数量超过上限 ${MAX_SYNC_FILE_ENTRIES}`);
      break;
    }
    const declaredSize = zipEntrySize(entry);
    if (declaredSize > MAX_SYNC_SINGLE_FILE_BYTES) {
      result.filesSkipped += 1;
      result.errors.push(`跳过过大的文件: ${entry.entryName}`);
      continue;
    }
    if (declaredSize && totalFileBytes + declaredSize > MAX_SYNC_TOTAL_FILE_BYTES) {
      result.filesSkipped += 1;
      result.errors.push(`跳过文件 ${entry.entryName}: ZIP 解压后总文件体积超过上限`);
      continue;
    }
    // 双层防御:即使 entryName 通过了前缀过滤,path.resolve 后仍要落在 uploadsRoot 内,
    // 防止 "uploads/../../etc/passwd" / 绝对路径 / 反斜线注入等绕过。
    const dest = path.resolve(publicDir, entry.entryName);
    if (
      !/^uploads\/video\/[A-Za-z0-9._-]+$/.test(entry.entryName)
      || (dest !== uploadsRoot && !dest.startsWith(uploadsRoot + path.sep))
    ) {
      result.filesSkipped += 1;
      result.errors.push(`跳过不安全路径: ${entry.entryName}`);
      continue;
    }
    const existingVideo = existingVideoById.get(incomingVideo.id);
    const incomingUpdatedAt = new Date(incomingVideo.updatedAt);
    if (
      existingVideo
      && incomingUpdatedAt <= existingVideo.updatedAt
      && await regularFileExists(dest)
    ) {
      // An older/equal package must never replace bytes belonging to a newer
      // local video record. Missing bytes may still be restored below.
      result.filesSkipped += 1;
      continue;
    }
    let temporaryPath = "";
    try {
      const data = entry.getData();
      if (data.length > MAX_SYNC_SINGLE_FILE_BYTES) {
        result.filesSkipped += 1;
        result.errors.push(`跳过过大的文件: ${entry.entryName}`);
        continue;
      }
      if (totalFileBytes + data.length > MAX_SYNC_TOTAL_FILE_BYTES) {
        result.filesSkipped += 1;
        result.errors.push(`跳过文件 ${entry.entryName}: ZIP 解压后总文件体积超过上限`);
        continue;
      }
      await fs.mkdir(path.dirname(dest), { recursive: true });
      temporaryPath = path.join(
        path.dirname(dest),
        `.sync-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`
      );
      await fs.writeFile(temporaryPath, data, { flag: "wx", mode: 0o640 });
      await fs.rename(temporaryPath, dest);
      temporaryPath = "";
      totalFileBytes += data.length;
      result.filesWritten += 1;
    } catch (err) {
      if (temporaryPath) await fs.unlink(temporaryPath).catch(() => undefined);
      result.filesSkipped += 1;
      result.errors.push(`写入文件 ${entry.entryName} 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2) upsert posts
  for (const incoming of bundle.posts) {
    try {
      const action = await upsertPost(incoming);
      if (action === "upserted") result.postsUpserted += 1;
      else result.postsSkipped += 1;
    } catch (err) {
      result.errors.push(`Post ${incoming.slug} 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3) upsert videos
  for (const incoming of bundle.videos) {
    try {
      const action = await upsertVideo(incoming);
      if (action === "upserted") result.videosUpserted += 1;
      else result.videosSkipped += 1;
    } catch (err) {
      result.errors.push(`Video ${incoming.id} 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 4) 更新 SyncState。只在整个导入没有错误时推进增量水位；否则下一轮
  // 必须重新覆盖本批数据，避免失败记录因 updatedAt 早于新水位而永久漏同步。
  try {
    const completedAt = new Date();
    const importedThrough = new Date(bundle.manifest.exportedAt);
    const succeeded = result.errors.length === 0;
    await prisma.syncState.upsert({
      where: { id: "sync" },
      create: {
        id: "sync",
        ...(succeeded ? { lastImportedAt: importedThrough } : {}),
        lastImportedPostCount: result.postsUpserted,
        lastError: result.errors.length ? result.errors.slice(0, 5).join("\n") : null,
        updatedAt: completedAt,
      },
      update: {
        ...(succeeded ? { lastImportedAt: importedThrough } : {}),
        lastImportedPostCount: result.postsUpserted,
        lastError: result.errors.length ? result.errors.slice(0, 5).join("\n") : null,
      },
    });
  } catch (err) {
    result.errors.push(`SyncState 更新失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

function validateBundleBeforeWrite(bundle: SyncBundle) {
  const postIds = new Set<string>();
  const slugs = new Set<string>();
  for (const post of bundle.posts) {
    if (!post || typeof post !== "object" || !cleanId(post.id) || !cleanText(post.slug, 240)) {
      throw new Error("同步包包含无效 Post id/slug");
    }
    if (postIds.has(post.id) || slugs.has(post.slug)) throw new Error(`同步包包含重复 Post: ${post.slug}`);
    postIds.add(post.id);
    slugs.add(post.slug);
    if (!cleanText(post.title, 500) || typeof post.summary !== "string" || typeof post.content !== "string") {
      throw new Error(`Post ${post.slug} 的标题或正文格式无效`);
    }
    if (!Array.isArray(post.tags) || !Array.isArray(post.topics)) throw new Error(`Post ${post.slug} 的关联格式无效`);
    if (!validDate(post.createdAt) || !validDate(post.updatedAt) || (post.publishedAt && !validDate(post.publishedAt))) {
      throw new Error(`Post ${post.slug} 包含无效时间`);
    }
    if (post.translatedAt && !validDate(post.translatedAt)) throw new Error(`Post ${post.slug} 的翻译时间无效`);
    if (!["DRAFT", "PUBLISHED", "ARCHIVED"].includes(post.status)) throw new Error(`Post ${post.slug} 的状态无效`);
    if (!["SINGLE_ARTICLE", "DAILY_DIGEST", "WEEKLY_ROUNDUP"].includes(post.kind)) {
      throw new Error(`Post ${post.slug} 的类型无效`);
    }
  }

  const videoIds = new Set<string>();
  for (const video of bundle.videos) {
    if (!video || typeof video !== "object" || !cleanId(video.id) || !cleanText(video.title, 500)) {
      throw new Error("同步包包含无效 Video id/title");
    }
    if (videoIds.has(video.id)) throw new Error(`同步包包含重复 Video: ${video.id}`);
    videoIds.add(video.id);
    if (!validDate(video.createdAt) || !validDate(video.updatedAt)) throw new Error(`Video ${video.id} 包含无效时间`);
    if (!Object.values(VideoType).includes(video.type)) throw new Error(`Video ${video.id} 的类型无效`);
    if (video.localPath) {
      const rel = video.localPath.replace(/^\/+/, "");
      if (!/^uploads\/video\/[A-Za-z0-9._-]+$/.test(rel)) throw new Error(`Video ${video.id} 的本地路径不安全`);
    }
  }
}

function cleanId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
}

function cleanText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

async function regularFileExists(filePath: string) {
  try {
    const stat = await fs.lstat(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

async function upsertPost(payload: SyncPostPayload): Promise<"upserted" | "skipped"> {
  if (!payload?.id || !payload.slug) {
    throw new Error("post payload 缺少 id 或 slug");
  }
  const incomingUpdatedAt = new Date(payload.updatedAt);
  if (Number.isNaN(incomingUpdatedAt.getTime())) {
    throw new Error("post payload 的 updatedAt 不是合法 ISO 时间");
  }

  // Older peers do not carry the structured publication block. Preserve sync
  // compatibility while preventing a legacy diagnostic/fallback from becoming
  // public merely because its payload says PUBLISHED.
  const publicationBlockedReason = generationPublicationBlockReason({
    summary: payload.summary,
    content: payload.content,
  });
  const status = payload.status === "PUBLISHED" && publicationBlockedReason ? "DRAFT" : payload.status;
  const baseData = {
    slug: payload.slug,
    title: payload.title,
    titleEn: payload.titleEn,
    summary: payload.summary,
    summaryEn: payload.summaryEn,
    content: payload.content,
    contentEn: payload.contentEn,
    status,
    publicationBlockedReason,
    kind: payload.kind,
    sourceUrl: payload.sourceUrl,
    sortOrder: payload.sortOrder,
    translatedAt: payload.translatedAt ? new Date(payload.translatedAt) : null,
    createdAt: new Date(payload.createdAt),
    updatedAt: incomingUpdatedAt,
    publishedAt: status === "PUBLISHED" && payload.publishedAt ? new Date(payload.publishedAt) : null,
  };

  return retryUniqueConflict(() =>
    prisma.$transaction(async (tx) => {
      const existingPost = await tx.post.findFirst({
        where: { OR: [{ id: payload.id }, { slug: payload.slug }] },
        select: { id: true, updatedAt: true, pendingRevision: true },
      });
      if (existingPost && incomingUpdatedAt <= existingPost.updatedAt) return "skipped";
      // A local pending revision is an explicit editorial lock. Applying a
      // remote live snapshot underneath it would make the later publish action
      // overwrite a version the editor never reviewed.
      if (existingPost?.pendingRevision !== null && existingPost?.pendingRevision !== undefined) return "skipped";

      // 关联准备和正文写入必须处于同一事务，避免正文成功但关系只写入一半。
      const tagConnects = await Promise.all(
        payload.tags.map(async (t) => {
          const tag = await tx.tag.upsert({
            where: { name: t.name },
            create: { name: t.name },
            update: {},
          });
          return { id: tag.id };
        })
      );
      const topicConnects: { id: string }[] = [];
      for (const t of payload.topics) {
        // frontend 模式下不凭同步包创建空 Topic，只连接本地已有项。
        const topic = await tx.contentTopic.findUnique({ where: { slug: t.slug }, select: { id: true } });
        if (topic) topicConnects.push({ id: topic.id });
      }

      if (!existingPost) {
        await tx.post.create({
          data: {
            id: payload.id,
            ...baseData,
            tags: { connect: tagConnects },
            topics: { connect: topicConnects },
          },
        });
        return "upserted";
      }

      // 原子比较并更新。若检查后已有更新版本先写入，count 为 0，旧包不会覆盖它。
      const updated = await tx.post.updateMany({
        where: { id: existingPost.id, updatedAt: { lt: incomingUpdatedAt } },
        data: baseData,
      });
      if (updated.count === 0) return "skipped";

      // updateMany 不支持关系写入；条件更新已锁住该行，在同一事务中替换权威关系。
      // 显式保留远端 updatedAt，避免关系更新触发 @updatedAt 改成导入时刻。
      await tx.post.update({
        where: { id: existingPost.id },
        data: {
          tags: { set: tagConnects },
          topics: { set: topicConnects },
          updatedAt: incomingUpdatedAt,
        },
      });
      return "upserted";
    })
  );
}

async function upsertVideo(payload: SyncVideoPayload): Promise<"upserted" | "skipped"> {
  if (!payload?.id) {
    throw new Error("video payload 缺少 id");
  }
  const incomingUpdatedAt = new Date(payload.updatedAt);
  if (Number.isNaN(incomingUpdatedAt.getTime())) {
    throw new Error("video payload 的 updatedAt 不是合法 ISO 时间");
  }

  // 边缘 case:之前一次"轻量同步"把视频写成了 LINK(因为当时无 mp4 文件),
  // 现在带着文件重来。即便 updatedAt 没变,只要本地刚刚落盘了对应文件,
  // 就允许把 LINK 提升回 LOCAL。否则用户视角:文件落盘了却看不到播放器。
  const localFileNow = Boolean(payload.localPath && (await localFileExists(payload.localPath)));

  return retryUniqueConflict(() =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.video.findUnique({
        where: { id: payload.id },
        select: { id: true, type: true, updatedAt: true },
      });
      const canUpgradeToLocal = Boolean(
        existing && payload.type === "LOCAL" && existing.type !== "LOCAL" && localFileNow
      );
      if (existing && incomingUpdatedAt <= existing.updatedAt && !canUpgradeToLocal) return "skipped";

      // 检查 incoming.postId 是否在本地存在；不存在则置 null 避免 FK 失败。
      let postId: string | null = null;
      if (payload.postId) {
        const post = await tx.post.findUnique({ where: { id: payload.postId }, select: { id: true } });
        postId = post ? post.id : null;
      }

      const localPath = localFileNow ? payload.localPath : null;
      const data = {
        title: payload.title,
        type: localPath ? payload.type : payload.type === "LOCAL" ? VideoType.LINK : payload.type,
        url: localPath ? payload.url : payload.type === "LOCAL" ? payload.url || "" : payload.url,
        coverUrl: payload.coverUrl,
        summary: payload.summary,
        displayMode: payload.displayMode === "link" ? "link" : "embed",
        sortOrder: payload.sortOrder,
        durationSec: payload.durationSec,
        region: payload.region,
        sourcePlatform: payload.sourcePlatform,
        sourcePageUrl: payload.sourcePageUrl,
        localPath,
        fileSizeBytes: localPath ? payload.fileSizeBytes : null,
        attribution: payload.attribution,
        postId,
        createdAt: new Date(payload.createdAt),
        // LINK→LOCAL 的补偿导入需要成为新版本，否则下一轮会再次被视为旧数据。
        updatedAt: canUpgradeToLocal && existing && incomingUpdatedAt <= existing.updatedAt
          ? new Date()
          : incomingUpdatedAt,
      };

      if (!existing) {
        await tx.video.create({ data: { id: payload.id, ...data } });
        return "upserted";
      }

      const updated = await tx.video.updateMany({
        where: canUpgradeToLocal && incomingUpdatedAt <= existing.updatedAt
          ? { id: payload.id, updatedAt: existing.updatedAt, type: { not: VideoType.LOCAL } }
          : { id: payload.id, updatedAt: { lt: incomingUpdatedAt } },
        data,
      });
      return updated.count === 1 ? "upserted" : "skipped";
    })
  );
}

async function retryUniqueConflict<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    // 两个导入都观察到“不存在”时只会有一个 create 成功；重跑后按 updatedAt
    // 重新判定即可。持久的唯一键冲突仍会在第二次抛出，不会被吞掉。
    if (!isUniqueConstraintError(error)) throw error;
    return operation();
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function localFileExists(localPath: string): Promise<boolean> {
  const rel = localPath.replace(/^\/+/, "");
  if (!rel.startsWith("uploads/")) return false;
  const abs = path.resolve(process.cwd(), "public", rel);
  const uploadsRoot = path.resolve(process.cwd(), "public", "uploads");
  if (abs !== uploadsRoot && !abs.startsWith(uploadsRoot + path.sep)) return false;
  try {
    const stat = await fs.stat(abs);
    return stat.isFile();
  } catch {
    return false;
  }
}

export type { SyncBundle };

function zipEntrySize(entry: { header?: { size?: number } }) {
  const size = Number(entry.header?.size || 0);
  return Number.isFinite(size) && size > 0 ? size : 0;
}
