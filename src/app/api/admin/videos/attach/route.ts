import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePublicContent } from "@/lib/revalidate-public";
import { redirectTo } from "@/lib/redirect";
import { rejectCrossOriginMutation } from "@/lib/request-origin";
import { revisionMediaBlockedRedirect } from "@/lib/post-revision";
import { normalizeVideoDisplayMode, removeVideoShortcode } from "@/lib/video-display";

class PendingRevisionMediaError extends Error {}
class AttachVideoNotFoundError extends Error {}
class AttachPostNotFoundError extends Error {}

// 把 Video 关联到 / 解除关联到 一篇文章。
// POST /api/admin/videos/attach
//   form: id=<videoId>, postId=<postId 或 空字符串>, redirect=<跳回路径>
//   postId 为空字符串 → 解除关联（视频成为「未挂载」状态）
export async function POST(request: Request) {
  const denied = rejectCrossOriginMutation(request);
  if (denied) return denied;
  await requireAdmin();
  const form = await request.formData();
  const id = String(form.get("id") || "").trim();
  const postIdRaw = String(form.get("postId") || "").trim();
  const redirect = safeRedirectPath(String(form.get("redirect") || "/admin/videos"));
  const displayModeData = form.has("displayMode")
    ? { displayMode: normalizeVideoDisplayMode(form.get("displayMode")) }
    : {};
  if (!id) return NextResponse.json({ error: "missing video id" }, { status: 400 });

  const changedPaths = new Set<string>();
  try {
    await prisma.$transaction(async (tx) => {
      const lockedVideos = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "Video" WHERE "id" = ${id} FOR UPDATE
      `);
      if (!lockedVideos.length) throw new AttachVideoNotFoundError();
      const video = await tx.video.findUnique({ where: { id }, select: { id: true, postId: true } });
      if (!video) throw new AttachVideoNotFoundError();

      const postIds = [...new Set([video.postId, postIdRaw || null]
        .filter((value): value is string => Boolean(value)))].sort();
      if (postIds.length) {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Post"
          WHERE "id" IN (${Prisma.join(postIds)})
          ORDER BY "id"
          FOR UPDATE
        `);
      }
      const posts = postIds.length ? await tx.post.findMany({
        where: { id: { in: postIds } },
        select: { id: true, slug: true, content: true, contentEn: true, pendingRevision: true }
      }) : [];
      const previousPost = video.postId ? posts.find((post) => post.id === video.postId) : null;
      const nextPost = postIdRaw ? posts.find((post) => post.id === postIdRaw) : null;
      if (postIdRaw && !nextPost) throw new AttachPostNotFoundError();
      if ((previousPost && previousPost.pendingRevision !== null) || (nextPost && nextPost.pendingRevision !== null)) {
        throw new PendingRevisionMediaError();
      }

      await tx.video.update({
        where: { id },
        data: postIdRaw
          ? { ...displayModeData, post: { connect: { id: postIdRaw } } }
          : { ...displayModeData, post: { disconnect: true } }
      });

      // Moving/unmounting also removes the old shortcode atomically. Public
      // rendering resolves video IDs globally, so leaving it behind would keep
      // showing a video that no longer belongs to the article.
      if (previousPost && previousPost.id !== postIdRaw && postContainsShortcode(previousPost, id)) {
        await tx.post.update({
          where: { id: previousPost.id },
          data: {
            content: removeVideoShortcode(previousPost.content, id),
            ...(previousPost.contentEn ? { contentEn: removeVideoShortcode(previousPost.contentEn, id) } : {})
          }
        });
      }
      if (previousPost) changedPaths.add(`/posts/${previousPost.slug}`);
      if (nextPost) changedPaths.add(`/posts/${nextPost.slug}`);
    });
  } catch (error) {
    if (error instanceof PendingRevisionMediaError) {
      return redirectTo(revisionMediaBlockedRedirect(redirect), request);
    }
    if (error instanceof AttachVideoNotFoundError) return NextResponse.json({ error: "video not found" }, { status: 404 });
    if (error instanceof AttachPostNotFoundError) return NextResponse.json({ error: "post not found" }, { status: 404 });
    throw error;
  }

  revalidatePublicContent([...changedPaths]);
  return redirectTo(redirect);
}

function postContainsShortcode(post: { content: string; contentEn: string | null }, videoId: string) {
  const token = `[[video:${videoId}]]`;
  return post.content.includes(token) || Boolean(post.contentEn?.includes(token));
}

function safeRedirectPath(value: string) {
  return value.startsWith("/admin/") || value === "/admin" ? value : "/admin/videos";
}
