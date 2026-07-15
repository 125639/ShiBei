import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { Prisma, VideoType } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { normalizeSortOrder } from "@/lib/form-number";
import { prisma } from "@/lib/prisma";
import { revalidatePublicContent } from "@/lib/revalidate-public";
import { redirectTo } from "@/lib/redirect";
import { rejectCrossOriginMutation } from "@/lib/request-origin";
import { revisionMediaBlockedRedirect } from "@/lib/post-revision";
import { VIDEO_DIR, ensureUploadDirs } from "@/lib/storage";
import { writeUploadedFile } from "@/lib/upload-stream";
import { uploadedMediaSignatureProblem } from "@/lib/upload-signatures";
import {
  insertVideoShortcode,
  normalizeEmbedUrl,
  normalizeVideoDisplayMode,
  normalizeVideoPlacement
} from "@/lib/video-display";

const ALLOWED_EXT = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const MAX_BYTES = 300 * 1024 * 1024;

class PendingRevisionMediaError extends Error {}
class TargetPostNotFoundError extends Error {}

export async function POST(request: Request) {
  const denied = rejectCrossOriginMutation(request);
  if (denied) return denied;
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
  let uploadedAbsolutePath: string | null = null;

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "视频文件过大，单文件上限 300MB" }, { status: 400 });
    const ext = path.extname(file.name || "video.mp4").toLowerCase() || ".mp4";
    if (!ALLOWED_EXT.has(ext)) return NextResponse.json({ error: `不支持的视频格式：${ext}` }, { status: 400 });
    const signatureProblem = await uploadedMediaSignatureProblem(file, ext, "video");
    if (signatureProblem) return NextResponse.json({ error: signatureProblem }, { status: 400 });
    const id = crypto.randomBytes(8).toString("hex");
    const fileName = `${id}${ext}`;
    uploadedAbsolutePath = path.join(VIDEO_DIR, fileName);
    const bytesWritten = await writeUploadedFile(file, uploadedAbsolutePath, MAX_BYTES);
    videoUrl = `/uploads/video/${fileName}`;
    type = "LOCAL";
    fileSizeBytes = bytesWritten;
  }

  if (!videoUrl) return NextResponse.json({ error: "请上传视频文件或填写视频链接" }, { status: 400 });

  const videoData = {
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
      attribution: String(form.get("attribution") || "").trim() || null
  };
  let postSlug: string | null = null;
  try {
    if (postId) {
      await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id" FROM "Post" WHERE "id" = ${postId} FOR UPDATE
        `);
        if (!locked.length) throw new TargetPostNotFoundError();
        const post = await tx.post.findUnique({
          where: { id: postId },
          select: { id: true, slug: true, content: true, contentEn: true, pendingRevision: true }
        });
        if (!post) throw new TargetPostNotFoundError();
        if (post.pendingRevision !== null) throw new PendingRevisionMediaError();
        postSlug = post.slug;
        const created = await tx.video.create({
          data: { ...videoData, post: { connect: { id: post.id } } },
          select: { id: true }
        });
        if (insertShortcode) {
          await tx.post.update({
            where: { id: post.id },
            data: {
              content: insertVideoShortcode(post.content, created.id, insertPlacement),
              ...(post.contentEn ? { contentEn: insertVideoShortcode(post.contentEn, created.id, insertPlacement) } : {})
            }
          });
        }
      });
    } else {
      await prisma.video.create({ data: videoData, select: { id: true } });
    }
  } catch (error) {
    if (uploadedAbsolutePath) await fs.unlink(uploadedAbsolutePath).catch(() => undefined);
    if (error instanceof PendingRevisionMediaError) {
      return redirectTo(revisionMediaBlockedRedirect(`/admin/posts/${postId}`), request);
    }
    if (error instanceof TargetPostNotFoundError) {
      return NextResponse.json({ error: "post not found" }, { status: 404 });
    }
    throw error;
  }

  revalidatePublicContent([postSlug ? `/posts/${postSlug}` : null]);
  return redirectTo(postId ? `/admin/posts/${postId}` : "/admin/videos");
}

function normalizeVideoType(value: string): VideoType {
  if (value === "LOCAL" || value === "EMBED" || value === "LINK") return value;
  return "LINK";
}
