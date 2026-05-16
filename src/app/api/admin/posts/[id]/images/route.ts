import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  buildArticleImageFigureHtml,
  insertArticleImageFiguresIntoPost,
  normalizeArticleImagePlacement,
  saveUploadedArticleImage
} from "@/lib/article-images";
import { redirectTo } from "@/lib/redirect";
import { ensureUploadDirs } from "@/lib/storage";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  await ensureUploadDirs();
  const { id } = await params;
  const form = await request.formData();
  const file = form.get("file");
  // redirect 只允许站内路径，避免上传接口被用作开放重定向。
  const redirect = safeRedirectPath(String(form.get("redirect") || `/admin/posts/${id}`));

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
  await insertArticleImageFiguresIntoPost(id, [figure], {
    placement: normalizeArticleImagePlacement(form.get("insertPlacement") || "after-intro"),
    mirrorToEnglish: form.get("mirrorToEnglish") === "true"
  });

  return redirectTo(redirect);
}

function safeRedirectPath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return "/admin/posts";
  return value;
}
