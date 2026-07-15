import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePublicContent } from "@/lib/revalidate-public";
import { rejectCrossOriginMutation } from "@/lib/request-origin";
import { parseJsonBody } from "@/lib/request-validation";
import {
  insertVideoShortcode,
  normalizeVideoPlacement,
  removeVideoShortcode,
  type VideoPlacement
} from "@/lib/video-display";

const ReorderSchema = z.object({
  postId: z.string().nullable().optional(),
  items: z.array(z.object({
    id: z.string(),
    sortOrder: z.number().finite(),
    placement: z.string().optional()
  })).min(1, "items must be non-empty")
});

class PendingRevisionMediaError extends Error {}
class VideoGroupError extends Error {}
class ReorderPostNotFoundError extends Error {}

export async function POST(request: Request) {
  const denied = rejectCrossOriginMutation(request);
  if (denied) return denied;
  await requireAdmin();
  const parsed = await parseJsonBody(request, ReorderSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const items = body.items
    .map((item) => ({
      id: String(item.id || "").trim(),
      sortOrder: Number.isFinite(item.sortOrder) ? Math.floor(item.sortOrder) : 0,
      placement: normalizeVideoPlacement(item.placement)
    }))
    .filter((item) => item.id);

  if (items.length === 0) {
    return NextResponse.json({ error: "no valid items" }, { status: 400 });
  }
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    return NextResponse.json({ error: "duplicate video ids" }, { status: 400 });
  }

  const postId = body.postId ? String(body.postId).trim() : "";

  const revalidatePaths: string[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      const itemIds = items.map((item) => item.id).sort();
      const lockedVideos = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "Video"
        WHERE "id" IN (${Prisma.join(itemIds)})
        ORDER BY "id"
        FOR UPDATE
      `);
      if (lockedVideos.length !== itemIds.length) throw new VideoGroupError();
      const videos = await tx.video.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, postId: true }
      });
      // The request may only reorder one real ownership group. `postId:null`
      // means genuinely unattached videos, not “skip ownership checks”.
      if (videos.some((video) => (video.postId || "") !== postId)) {
        throw new VideoGroupError();
      }

      let post: { id: string; slug: string; content: string; contentEn: string | null; pendingRevision: unknown } | null = null;
      if (postId) {
        const lockedPosts = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id" FROM "Post" WHERE "id" = ${postId} FOR UPDATE
        `);
        if (!lockedPosts.length) throw new ReorderPostNotFoundError();
        post = await tx.post.findUnique({
          where: { id: postId },
          select: { id: true, slug: true, content: true, contentEn: true, pendingRevision: true }
        });
        if (!post) throw new ReorderPostNotFoundError();
        if (post.pendingRevision !== null) throw new PendingRevisionMediaError();
      }

      for (const item of items) {
        await tx.video.update({
          where: { id: item.id },
          data: {
            sortOrder: item.sortOrder,
            lastPlacement: item.placement
          }
        });
      }

      if (post) {
        revalidatePaths.push(`/posts/${post.slug}`);
        const reorderedContent = rebuildPostContent(post.content, items);
        const reorderedContentEn = post.contentEn ? rebuildPostContent(post.contentEn, items) : null;
        await tx.post.update({
          where: { id: post.id },
          data: {
            content: reorderedContent,
            ...(reorderedContentEn !== null ? { contentEn: reorderedContentEn } : {})
          }
        });
      }
    });
  } catch (error) {
    if (error instanceof PendingRevisionMediaError) {
      return NextResponse.json({ error: "该文章有待审修改，请先发布或放弃待审版本" }, { status: 409 });
    }
    if (error instanceof VideoGroupError) {
      return NextResponse.json({ error: "视频列表不属于请求指定的文章，已拒绝重排" }, { status: 409 });
    }
    if (error instanceof ReorderPostNotFoundError) {
      return NextResponse.json({ error: "post not found" }, { status: 404 });
    }
    throw error;
  }

  revalidatePublicContent(revalidatePaths);

  return NextResponse.json({ ok: true });
}

function rebuildPostContent(content: string, items: Array<{ id: string; placement: VideoPlacement }>) {
  let next = content;
  for (const item of items) {
    next = removeVideoShortcode(next, item.id);
  }
  for (const item of items) {
    next = insertVideoShortcode(next, item.id, item.placement);
  }
  return next;
}
