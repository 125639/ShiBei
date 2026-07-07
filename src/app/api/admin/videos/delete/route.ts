import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePublicContent } from "@/lib/revalidate-public";
import { redirectTo } from "@/lib/redirect";
import { resolveUploadsPath } from "@/lib/uploads-path";
import { removeVideoShortcode } from "@/lib/video-display";

// 删除整个视频记录（含本地文件）。
// POST /api/admin/videos/delete?id=...&redirect=/admin/posts/<post-id>
// 仅接受 POST：删除是状态变更，GET 会被浏览器预取/链接预览误触发。
export async function POST(request: Request) {
  await requireAdmin();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const redirect = safeRedirectPath(url.searchParams.get("redirect"));
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const video = await prisma.video.findUnique({ where: { id }, include: { post: { select: { slug: true } } } });
  if (video?.localPath) {
    // 必须经过 resolveUploadsPath：DB 里被写入 "../etc/passwd" 一类值时
    // 直接 path.join 会让 fs.unlink 变成任意文件删除原语。
    const abs = resolveUploadsPath(video.localPath);
    if (abs) await fs.unlink(abs).catch(() => undefined);
  }
  if (video) {
    // 短代码可能出现在任意文章（含跨文章内嵌），不清会渲染成
    // "[未找到视频：xxx]" 占位框，所以先按内容扫出所有引用再删行。
    const cleanedSlugs = await stripShortcodeFromAllPosts(video.id);
    await prisma.video.delete({ where: { id } });
    revalidatePublicContent([
      video.post ? `/posts/${video.post.slug}` : null,
      ...cleanedSlugs.map((slug) => `/posts/${slug}`)
    ]);
  }
  return redirectTo(redirect);
}

async function stripShortcodeFromAllPosts(videoId: string): Promise<string[]> {
  const token = `[[video:${videoId}]]`;
  const posts = await prisma.post.findMany({
    where: { OR: [{ content: { contains: token } }, { contentEn: { contains: token } }] },
    select: { id: true, slug: true, content: true, contentEn: true }
  });
  for (const post of posts) {
    await prisma.post.update({
      where: { id: post.id },
      data: {
        content: removeVideoShortcode(post.content, videoId),
        ...(post.contentEn ? { contentEn: removeVideoShortcode(post.contentEn, videoId) } : {})
      }
    });
  }
  return posts.map((post) => post.slug);
}

function safeRedirectPath(value: string | null) {
  const raw = value || "/admin/videos";
  return raw.startsWith("/admin/") || raw === "/admin" ? raw : "/admin/videos";
}
