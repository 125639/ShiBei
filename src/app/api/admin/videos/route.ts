import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { VideoType } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { VIDEO_DIR, ensureUploadDirs } from "@/lib/storage";
import { insertVideoShortcode, normalizeVideoDisplayMode, normalizeVideoPlacement } from "@/lib/video-display";

const ALLOWED_EXT = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const MAX_BYTES = 300 * 1024 * 1024;

export async function POST(request: Request) {
  await requireAdmin();
  await ensureUploadDirs();
  const form = await request.formData();
  const file = form.get("file");
  const title = String(form.get("title") || "视频资源").trim() || "视频资源";
  const url = String(form.get("url") || "").trim();
  const postId = String(form.get("postId") || "").trim();
  const sortOrder = normalizeSortOrder(form.get("sortOrder"));
  const displayMode = normalizeVideoDisplayMode(form.get("displayMode") || "embed");
  const insertShortcode = form.get("insertShortcode") === "true";
  const insertPlacement = normalizeVideoPlacement(form.get("insertPlacement"));
  let videoUrl = url;
  let type = normalizeVideoType(String(form.get("type") || "LINK"));
  let fileSizeBytes: number | null = null;

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "视频文件过大，单文件上限 300MB" }, { status: 400 });
    const ext = path.extname(file.name || "video.mp4").toLowerCase() || ".mp4";
    if (!ALLOWED_EXT.has(ext)) return NextResponse.json({ error: `不支持的视频格式：${ext}` }, { status: 400 });
    const id = crypto.randomBytes(8).toString("hex");
    const fileName = `${id}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(VIDEO_DIR, fileName), buffer);
    videoUrl = `/uploads/video/${fileName}`;
    type = "LOCAL";
    fileSizeBytes = buffer.length;
  }

  if (!videoUrl) return NextResponse.json({ error: "请上传视频文件或填写视频链接" }, { status: 400 });

  const video = await prisma.video.create({
    data: {
      title,
      type,
      url: type === "EMBED" ? normalizeEmbedUrl(videoUrl) : videoUrl,
      displayMode,
      summary: String(form.get("summary") || ""),
      sortOrder,
      fileSizeBytes,
      localPath: type === "LOCAL" ? videoUrl : null,
      sourcePageUrl: String(form.get("sourcePageUrl") || "").trim() || null,
      sourcePlatform: String(form.get("sourcePlatform") || "").trim() || null,
      attribution: String(form.get("attribution") || "").trim() || null,
      ...(postId ? { post: { connect: { id: postId } } } : {})
    }
  });

  if (postId && insertShortcode) {
    await insertVideoIntoPost(postId, video.id, insertPlacement);
  }

  return redirectTo(postId ? `/admin/posts/${postId}` : "/admin/videos");
}

async function insertVideoIntoPost(postId: string, videoId: string, placement: ReturnType<typeof normalizeVideoPlacement>) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { content: true, contentEn: true }
  });
  if (!post) return;
  await prisma.post.update({
    where: { id: postId },
    data: {
      content: insertVideoShortcode(post.content, videoId, placement),
      ...(post.contentEn ? { contentEn: insertVideoShortcode(post.contentEn, videoId, placement) } : {})
    }
  });
}

function normalizeSortOrder(value: FormDataEntryValue | null) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

function normalizeVideoType(value: string): VideoType {
  if (value === "LOCAL" || value === "EMBED" || value === "LINK") return value;
  return "LINK";
}

function normalizeEmbedUrl(url: string) {
  const youtube = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]+)/);
  if (youtube) return `https://www.youtube.com/embed/${youtube[1]}`;
  const bilibili = url.match(/bilibili\.com\/video\/([A-Za-z0-9]+)/);
  if (bilibili) return `https://player.bilibili.com/player.html?bvid=${bilibili[1]}`;
  return url;
}
