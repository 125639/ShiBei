import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePublicContent } from "@/lib/revalidate-public";
import { redirectTo } from "@/lib/redirect";
import { rejectCrossOriginMutation } from "@/lib/request-origin";
import { revisionMediaBlockedRedirect } from "@/lib/post-revision";
import {
  insertVideoShortcode,
  normalizeVideoDisplayMode,
  normalizeVideoPlacement,
  removeVideoShortcode
} from "@/lib/video-display";

class PendingRevisionMediaError extends Error {}
class VideoNotFoundError extends Error {}
class PostNotFoundError extends Error {}

export async function POST(request: Request) {
  const denied = rejectCrossOriginMutation(request);
  if (denied) return denied;
  await requireAdmin();
  const form = await request.formData();
  const id = String(form.get("id") || "").trim();
  const postId = String(form.get("postId") || "").trim();
  const redirect = safeRedirectPath(String(form.get("redirect") || (postId ? `/admin/posts/${postId}` : "/admin/videos")));
  if (!id || !postId) return NextResponse.json({ error: "missing video id or post id" }, { status: 400 });

  const displayMode = normalizeVideoDisplayMode(form.get("displayMode"));
  const placement = normalizeVideoPlacement(form.get("insertPlacement"));
  const changedPaths = new Set<string>();
  try {
    await prisma.$transaction(async (tx) => {
      // Lock the media row first, then every source/target Post in stable order.
      // This makes the pending-revision check and all relationship/shortcode
      // writes one atomic operation instead of a TOCTOU window.
      const lockedVideos = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "Video" WHERE "id" = ${id} FOR UPDATE
      `);
      if (!lockedVideos.length) throw new VideoNotFoundError();
      const video = await tx.video.findUnique({ where: { id }, select: { id: true, postId: true } });
      if (!video) throw new VideoNotFoundError();

      const postIds = [...new Set([postId, video.postId].filter((value): value is string => Boolean(value)))].sort();
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Post"
        WHERE "id" IN (${Prisma.join(postIds)})
        ORDER BY "id"
        FOR UPDATE
      `);
      const posts = await tx.post.findMany({
        where: { id: { in: postIds } },
        select: { id: true, slug: true, content: true, contentEn: true, pendingRevision: true }
      });
      const target = posts.find((post) => post.id === postId);
      if (!target) throw new PostNotFoundError();
      const source = video.postId ? posts.find((post) => post.id === video.postId) : null;
      if (target.pendingRevision !== null || (source && source.pendingRevision !== null)) {
        throw new PendingRevisionMediaError();
      }

      await tx.video.update({
        where: { id },
        data: {
          displayMode,
          lastPlacement: placement,
          post: { connect: { id: target.id } }
        }
      });

      if (source && source.id !== target.id) {
        await tx.post.update({
          where: { id: source.id },
          data: {
            content: removeVideoShortcode(source.content, id),
            ...(source.contentEn ? { contentEn: removeVideoShortcode(source.contentEn, id) } : {})
          }
        });
        changedPaths.add(`/posts/${source.slug}`);
      }
      await tx.post.update({
        where: { id: target.id },
        data: {
          content: insertVideoShortcode(target.content, id, placement),
          ...(target.contentEn ? { contentEn: insertVideoShortcode(target.contentEn, id, placement) } : {})
        }
      });
      changedPaths.add(`/posts/${target.slug}`);
    });
  } catch (error) {
    if (error instanceof PendingRevisionMediaError) {
      return redirectTo(revisionMediaBlockedRedirect(redirect), request);
    }
    if (error instanceof VideoNotFoundError) return NextResponse.json({ error: "video not found" }, { status: 404 });
    if (error instanceof PostNotFoundError) return NextResponse.json({ error: "post not found" }, { status: 404 });
    throw error;
  }

  revalidatePublicContent([...changedPaths]);
  return redirectTo(redirect);
}

function safeRedirectPath(value: string) {
  return value.startsWith("/admin/") || value === "/admin" ? value : "/admin/videos";
}
