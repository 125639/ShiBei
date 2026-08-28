import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  buildArticleImageFigureHtml,
  insertArticleImageFiguresIntoPost,
  normalizeArticleImagePlacement,
  PostMediaConflictError,
  saveUploadedArticleImage
} from "@/lib/article-images";
import { prisma } from "@/lib/prisma";
import { revalidatePublicContent } from "@/lib/revalidate-public";
import { redirectTo } from "@/lib/redirect";
import { revisionMediaBlockedRedirect } from "@/lib/post-revision";
import { ensureUploadDirs } from "@/lib/storage";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  await ensureUploadDirs();
  const { id } = await params;
  const form = await request.formData();
  const file = form.get("file");
  // redirect 只允许站内路径，避免上传接口被用作开放重定向。
  const redirect = safeRedirectPath(String(form.get("redirect") || `/admin/posts/${id}`));
  const currentPost = await prisma.post.findUnique({
    where: { id },
    select: { pendingRevision: true }
  });
  if (!currentPost) return NextResponse.json({ error: "post not found" }, { status: 404 });
  if (currentPost.pendingRevision !== null) {
    return redirectTo(revisionMediaBlockedRedirect(redirect), request);
  }

  if (!(file instanceof File) || file.size <= 0) {
    return NextResponse.json({ error: "请上传图片文件" }, { status: 400 });
  }

  // 保存阶段会按文件头校验真实格式，并把文件落到 public/uploads/image。
  const saved = await saveUploadedArticleImage(file);
  if (!saved) {
    return NextResponse.json({ error: "图片无效或过大，仅支持 JPG / PNG / WebP / GIF，单文件上限 8MB" }, { status: 400 });
  }

  const caption = String(form.get("caption") || "").trim() || file.name || "文章配图";
  const sourcePageUrl = String(form.get("sourcePageUrl") || "").trim() || null;
  const figure = buildArticleImageFigureHtml({
    src: saved.url,
    caption,
    sourcePageUrl
  });

  // 图片作为 figure 直接插入 Markdown 正文，不额外建表，前台渲染路径和自动配图一致。
  try {
    await insertArticleImageFiguresIntoPost(id, [figure], {
      placement: normalizeArticleImagePlacement(form.get("insertPlacement") || "after-intro"),
      mirrorToEnglish: form.get("mirrorToEnglish") === "true"
    });
  } catch (error) {
    if (error instanceof PostMediaConflictError) {
      return redirectTo(revisionMediaBlockedRedirect(redirect), request);
    }
    throw error;
  }

  const post = await prisma.post.findUnique({ where: { id }, select: { slug: true } });
  revalidatePublicContent([post ? `/posts/${post.slug}` : null]);
  return redirectTo(redirect);
}

function safeRedirectPath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return "/admin/posts";
  return value;
}
