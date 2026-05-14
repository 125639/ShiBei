import fs from "node:fs/promises";
import path from "node:path";
import { VideoType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureUploadDirs } from "@/lib/storage";
import { parseSyncZip } from "./export";
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
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    if (!entry.entryName.startsWith("uploads/")) continue;
    // 双层防御:即使 entryName 通过了前缀过滤,path.resolve 后仍要落在 uploadsRoot 内,
    // 防止 "uploads/../../etc/passwd" / 绝对路径 / 反斜线注入等绕过。
    const dest = path.resolve(publicDir, entry.entryName);
    if (dest !== uploadsRoot && !dest.startsWith(uploadsRoot + path.sep)) {
      result.filesSkipped += 1;
      result.errors.push(`跳过不安全路径: ${entry.entryName}`);
      continue;
    }
    try {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, entry.getData());
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

  // 4) 更新 SyncState
  try {
    await prisma.syncState.upsert({
      where: { id: "sync" },
      create: {
        id: "sync",
        lastImportedAt: new Date(),
        lastImportedPostCount: result.postsUpserted,
        lastError: result.errors.length ? result.errors.slice(0, 5).join("\n") : null,
        updatedAt: new Date(),
      },
      update: {
        lastImportedAt: new Date(),
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
  const existingPost = await prisma.post.findFirst({
    where: { OR: [{ id: payload.id }, { slug: payload.slug }] },
    select: { id: true, slug: true, updatedAt: true },
  });
  const incomingUpdatedAt = new Date(payload.updatedAt);
  if (Number.isNaN(incomingUpdatedAt.getTime())) {
    throw new Error("post payload 的 updatedAt 不是合法 ISO 时间");
  }
  if (existingPost && incomingUpdatedAt <= existingPost.updatedAt) {
    return "skipped";
  }

  // 准备 tags / topics 关联（按 name/slug upsert）
  const tagConnects = await Promise.all(
    payload.tags.map(async (t) => {
      const tag = await prisma.tag.upsert({
        where: { name: t.name },
        create: { name: t.name },
        update: {},
      });
      return { id: tag.id };
    })
  );

  const topicConnects: { id: string }[] = [];
  for (const t of payload.topics) {
    // Topic 表(NewsTopic)在 frontend 模式下大概率为空。我们按 slug 查；找不到就跳过该 topic 关联（避免在前端创建空 Topic）。
    const existingTopic = await prisma.newsTopic.findUnique({ where: { slug: t.slug }, select: { id: true } });
    if (existingTopic) topicConnects.push({ id: existingTopic.id });
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

  if (existingPost) {
    await prisma.post.update({
      where: { id: existingPost.id },
      data: {
        ...baseData,
        // tags / topics:set 替换（incoming 视为权威）
        tags: { set: tagConnects },
        topics: { set: topicConnects },
      },
    });
  } else {
    await prisma.post.create({
      data: {
        id: payload.id,
        ...baseData,
        tags: { connect: tagConnects },
        topics: { connect: topicConnects },
      },
    });
  }
  return "upserted";
}

async function upsertVideo(payload: SyncVideoPayload): Promise<"upserted" | "skipped"> {
  if (!payload?.id) {
    throw new Error("video payload 缺少 id");
  }
  const existing = await prisma.video.findUnique({
    where: { id: payload.id },
    select: { id: true, type: true, localPath: true, updatedAt: true },
  });
  const incomingUpdatedAt = new Date(payload.updatedAt);
  if (Number.isNaN(incomingUpdatedAt.getTime())) {
    throw new Error("video payload 的 updatedAt 不是合法 ISO 时间");
  }

  // 边缘 case:之前一次"轻量同步"把视频写成了 LINK(因为当时无 mp4 文件),
  // 现在带着文件重来。即便 updatedAt 没变,只要本地刚刚落盘了对应文件,
  // 就允许把 LINK 提升回 LOCAL。否则用户视角:文件落盘了却看不到播放器。
  const localFileNow = payload.localPath && (await localFileExists(payload.localPath));
  const canUpgradeToLocal =
    existing &&
    payload.type === "LOCAL" &&
    existing.type !== "LOCAL" &&
    localFileNow;

  if (existing && incomingUpdatedAt <= existing.updatedAt && !canUpgradeToLocal) {
    return "skipped";
  }

  // 检查 incoming.postId 是否在本地存在；不存在则置 null 避免 FK 失败。
  let postId: string | null = null;
  if (payload.postId) {
    const post = await prisma.post.findUnique({ where: { id: payload.postId }, select: { id: true } });
    postId = post ? post.id : null;
  }

  const localPath = localFileNow ? payload.localPath : null;
  const data = {
    title: payload.title,
    type: localPath ? payload.type : payload.type === "LOCAL" ? VideoType.LINK : payload.type,
    url: localPath ? payload.url : payload.type === "LOCAL" ? "" : payload.url,
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
    // 升级 LINK→LOCAL 时,如果不更新 updatedAt 就会被下次同步又当成 stale skip。
    // 主动把 updatedAt 拨到 max(existing, incoming, now)。
    updatedAt:
      canUpgradeToLocal && existing && incomingUpdatedAt <= existing.updatedAt
        ? new Date()
        : incomingUpdatedAt,
  };

  // 如果是 LOCAL 视频但本地文件没拿到,降级 LINK 时 url 必须有值;否则 prisma 会抛 NOT NULL。
  // payload.url 在 LOCAL 模式下通常是 "/uploads/video/xxx.mp4"——保留它,前端会显示为不可播放占位。
  if (data.url === "") {
    data.url = payload.url || "";
  }

  if (existing) {
    await prisma.video.update({ where: { id: payload.id }, data });
  } else {
    await prisma.video.create({ data: { id: payload.id, ...data } });
  }
  return "upserted";
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
