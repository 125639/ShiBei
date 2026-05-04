import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

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
  if (!id) return NextResponse.json({ error: "missing video id" }, { status: 400 });

  const video = await prisma.video.findUnique({ where: { id } });
  if (!video) return NextResponse.json({ error: "video not found" }, { status: 404 });

  if (postIdRaw) {
    const post = await prisma.post.findUnique({ where: { id: postIdRaw }, select: { id: true } });
    if (!post) return NextResponse.json({ error: "post not found" }, { status: 404 });
    await prisma.video.update({
      where: { id },
      data: { post: { connect: { id: post.id } } },
    });
  } else {
    await prisma.video.update({
      where: { id },
      data: { post: { disconnect: true } },
    });
  }

  return redirectTo(redirect);
}

function safeRedirectPath(value: string) {
  return value.startsWith("/admin/") || value === "/admin" ? value : "/admin/videos";
}
