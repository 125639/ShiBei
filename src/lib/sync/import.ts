import fs from "node:fs/promises";
import path from "node:path";
import { VideoType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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
  let fileEntries = 0;
  let totalFileBytes = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    if (!entry.entryName.startsWith("uploads/")) continue;
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
    if (dest !== uploadsRoot && !dest.startsWith(uploadsRoot + path.sep)) {
      result.filesSkipped += 1;
      result.errors.push(`跳过不安全路径: ${entry.entryName}`);
      continue;
    }
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
      await fs.writeFile(dest, data);
      totalFileBytes += data.length;
      result.filesWritten += 1;
    } catch (err) {
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

async function upsertPost(payload: SyncPostPayload): Promise<"upserted" | "skipped"> {
  if (!payload?.id || !payload.slug) {
    throw new Error("post payload 缺少 id 或 slug");
  }
  const incomingUpdatedAt = new Date(payload.updatedAt);
  if (Number.isNaN(incomingUpdatedAt.getTime())) {
    throw new Error("post payload 的 updatedAt 不是合法 ISO 时间");
  }

  const baseData = {
    slug: payload.slug,
    title: payload.title,
    titleEn: payload.titleEn,
    summary: payload.summary,
    summaryEn: payload.summaryEn,
    content: payload.content,
    contentEn: payload.contentEn,
    status: payload.status,
    kind: payload.kind,
    sourceUrl: payload.sourceUrl,
    sortOrder: payload.sortOrder,
    translatedAt: payload.translatedAt ? new Date(payload.translatedAt) : null,
    createdAt: new Date(payload.createdAt),
    updatedAt: incomingUpdatedAt,
    publishedAt: payload.publishedAt ? new Date(payload.publishedAt) : null,
  };

  return retryUniqueConflict(() =>
    prisma.$transaction(async (tx) => {
      const existingPost = await tx.post.findFirst({
        where: { OR: [{ id: payload.id }, { slug: payload.slug }] },
        select: { id: true, updatedAt: true },
      });
      if (existingPost && incomingUpdatedAt <= existingPost.updatedAt) return "skipped";

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
