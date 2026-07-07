import crypto from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { VideoType } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { normalizeSortOrder } from "@/lib/form-number";
import { prisma } from "@/lib/prisma";
import { revalidatePublicContent } from "@/lib/revalidate-public";
import { redirectTo } from "@/lib/redirect";
import { VIDEO_DIR, ensureUploadDirs } from "@/lib/storage";
import { writeUploadedFile } from "@/lib/upload-stream";
import {
  insertVideoShortcode,
  normalizeEmbedUrl,
  normalizeVideoDisplayMode,
  normalizeVideoPlacement
} from "@/lib/video-display";

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
    const bytesWritten = await writeUploadedFile(file, path.join(VIDEO_DIR, fileName), MAX_BYTES);
    videoUrl = `/uploads/video/${fileName}`;
    type = "LOCAL";
    fileSizeBytes = bytesWritten;
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

  const post = postId
    ? await prisma.post.findUnique({ where: { id: postId }, select: { slug: true } })
    : null;
  revalidatePublicContent([post ? `/posts/${post.slug}` : null]);
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

function normalizeVideoType(value: string): VideoType {
  if (value === "LOCAL" || value === "EMBED" || value === "LINK") return value;
  return "LINK";
}
