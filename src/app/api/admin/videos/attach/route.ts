import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePublicContent } from "@/lib/revalidate-public";
import { redirectTo } from "@/lib/redirect";
import { normalizeVideoDisplayMode } from "@/lib/video-display";

// 把 Video 关联到 / 解除关联到 一篇文章。
// POST /api/admin/videos/attach
//   form: id=<videoId>, postId=<postId 或 空字符串>, redirect=<跳回路径>
//   postId 为空字符串 → 解除关联（视频成为「未挂载」状态）
export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const id = String(form.get("id") || "").trim();
  const postIdRaw = String(form.get("postId") || "").trim();
  const redirect = safeRedirectPath(String(form.get("redirect") || "/admin/videos"));
  const displayModeData = form.has("displayMode")
    ? { displayMode: normalizeVideoDisplayMode(form.get("displayMode")) }
    : {};
  if (!id) return NextResponse.json({ error: "missing video id" }, { status: 400 });

  const video = await prisma.video.findUnique({ where: { id }, include: { post: { select: { slug: true } } } });
  if (!video) return NextResponse.json({ error: "video not found" }, { status: 404 });

  let nextPostSlug: string | null = null;
  if (postIdRaw) {
    const post = await prisma.post.findUnique({ where: { id: postIdRaw }, select: { id: true, slug: true } });
    if (!post) return NextResponse.json({ error: "post not found" }, { status: 404 });
    nextPostSlug = post.slug;
    await prisma.video.update({
      where: { id },
      data: { ...displayModeData, post: { connect: { id: post.id } } },
    });
  } else {
    await prisma.video.update({
      where: { id },
      data: { ...displayModeData, post: { disconnect: true } },
    });
  }

  revalidatePublicContent([
    `/videos/${id}`,
    video.post ? `/posts/${video.post.slug}` : null,
    nextPostSlug ? `/posts/${nextPostSlug}` : null
  ]);
  return redirectTo(redirect);
}

function safeRedirectPath(value: string) {
  return value.startsWith("/admin/") || value === "/admin" ? value : "/admin/videos";
}
