import fs from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePublicContent } from "@/lib/revalidate-public";
import { redirectTo } from "@/lib/redirect";
import { rejectCrossOriginMutation } from "@/lib/request-origin";
import { revisionMediaBlockedRedirect } from "@/lib/post-revision";
import { resolveUploadsPath } from "@/lib/uploads-path";
import { removeVideoShortcode } from "@/lib/video-display";

class PendingRevisionVideoDeleteError extends Error {}

// 删除整个视频记录（含本地文件）。
// POST /api/admin/videos/delete?id=...&redirect=/admin/posts/<post-id>
// 仅接受 POST：删除是状态变更，GET 会被浏览器预取/链接预览误触发。
export async function POST(request: Request) {
  const denied = rejectCrossOriginMutation(request);
  if (denied) return denied;
  await requireAdmin();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const redirect = safeRedirectPath(url.searchParams.get("redirect"));
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  let deleted: { localPath: string | null; slugs: string[] } | null = null;
  try {
    deleted = await prisma.$transaction(async (tx) => {
      const lockedVideos = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "Video" WHERE "id" = ${id} FOR UPDATE
      `);
      if (!lockedVideos.length) return null;
      const video = await tx.video.findUnique({ where: { id }, select: { id: true, localPath: true } });
      if (!video) return null;

      // A shortcode can legally appear outside Video.postId. Lock the Post set
      // while scanning so a pending/live reference cannot appear between the
      // check and deletion. This admin-only operation is rare; correctness is
      // more important than briefly serializing article writes.
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Post" ORDER BY "id" FOR UPDATE`);
      const posts = await tx.post.findMany({
        select: { id: true, slug: true, content: true, contentEn: true, pendingRevision: true }
      });
      const token = `[[video:${video.id}]]`;
      const referencedPosts = posts.filter((post) =>
        post.content.includes(token) || Boolean(post.contentEn?.includes(token))
      );
      const pendingReference = posts.some((post) =>
        post.pendingRevision !== null
        && (JSON.stringify(post.pendingRevision).includes(token)
          || post.content.includes(token)
          || Boolean(post.contentEn?.includes(token)))
      );
      if (pendingReference) throw new PendingRevisionVideoDeleteError();

      for (const post of referencedPosts) {
        await tx.post.update({
          where: { id: post.id },
          data: {
            content: removeVideoShortcode(post.content, video.id),
            ...(post.contentEn ? { contentEn: removeVideoShortcode(post.contentEn, video.id) } : {})
          }
        });
      }
      await tx.video.delete({ where: { id: video.id } });
      return { localPath: video.localPath, slugs: referencedPosts.map((post) => post.slug) };
    });
  } catch (error) {
    if (error instanceof PendingRevisionVideoDeleteError) {
      return redirectTo(revisionMediaBlockedRedirect(redirect), request);
    }
    throw error;
  }

  if (deleted?.localPath) {
    // Delete the file only after the database commit. A failed unlink leaves an
    // unreferenced file that can be cleaned later, never a live player pointing
    // at a missing file.
    const abs = resolveUploadsPath(deleted.localPath);
    if (abs) await fs.unlink(abs).catch(() => undefined);
  }
  if (deleted) revalidatePublicContent(deleted.slugs.map((slug) => `/posts/${slug}`));
  return redirectTo(redirect);
}

function safeRedirectPath(value: string | null) {
  const raw = value || "/admin/videos";
  return raw.startsWith("/admin/") || raw === "/admin" ? raw : "/admin/videos";
}
