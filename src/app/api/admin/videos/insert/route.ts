import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import {
  insertVideoShortcode,
  normalizeVideoDisplayMode,
  normalizeVideoPlacement
} from "@/lib/video-display";

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const id = String(form.get("id") || "").trim();
  const postId = String(form.get("postId") || "").trim();
  const redirect = safeRedirectPath(String(form.get("redirect") || (postId ? `/admin/posts/${postId}` : "/admin/videos")));
  if (!id || !postId) return NextResponse.json({ error: "missing video id or post id" }, { status: 400 });

  const [video, post] = await Promise.all([
    prisma.video.findUnique({ where: { id }, select: { id: true } }),
    prisma.post.findUnique({ where: { id: postId }, select: { id: true, content: true, contentEn: true } })
  ]);
  if (!video) return NextResponse.json({ error: "video not found" }, { status: 404 });
  if (!post) return NextResponse.json({ error: "post not found" }, { status: 404 });

  const displayMode = normalizeVideoDisplayMode(form.get("displayMode"));
  const placement = normalizeVideoPlacement(form.get("insertPlacement"));

  await prisma.video.update({
    where: { id },
    data: {
      displayMode,
      lastPlacement: placement,
      post: { connect: { id: post.id } }
    }
  });

  await prisma.post.update({
    where: { id: post.id },
    data: {
      content: insertVideoShortcode(post.content, id, placement),
      ...(post.contentEn ? { contentEn: insertVideoShortcode(post.contentEn, id, placement) } : {})
    }
  });

  return redirectTo(redirect);
}

function safeRedirectPath(value: string) {
  return value.startsWith("/admin/") || value === "/admin" ? value : "/admin/videos";
}
