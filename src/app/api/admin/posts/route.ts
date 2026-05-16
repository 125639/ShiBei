import { CompilationKind, PostStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  buildArticleImageFigureHtml,
  insertArticleImageFiguresIntoPost,
  normalizeArticleImagePlacement,
  saveUploadedArticleImage
} from "@/lib/article-images";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { slugify } from "@/lib/slug";
import { ensureUploadDirs } from "@/lib/storage";

export async function POST(request: Request) {
  await requireAdmin();
  await ensureUploadDirs();
  const form = await request.formData();
  const title = String(form.get("title") || "未命名文章").trim() || "未命名文章";
  const status = normalizeStatus(String(form.get("status") || "DRAFT"));
  const slugBase = slugify(String(form.get("slug") || title));
  const slug = await uniqueSlug(slugBase);
  const tags = parseTags(String(form.get("tags") || ""));
  const imageFile = form.get("imageFile");
  // 新建文章时允许顺手上传一张正文图，和编辑页上传共用同一套校验/插入逻辑。
  const uploadedImage = imageFile instanceof File && imageFile.size > 0
    ? await saveUploadedArticleImage(imageFile)
    : null;

  if (imageFile instanceof File && imageFile.size > 0 && !uploadedImage) {
    return NextResponse.json({ error: "图片无效或过大，仅支持 JPG / PNG / WebP / GIF，单文件上限 8MB" }, { status: 400 });
  }

  const post = await prisma.post.create({
    data: {
      slug,
      title,
      summary: String(form.get("summary") || ""),
      content: String(form.get("content") || ""),
      status,
      kind: normalizeKind(String(form.get("kind") || "SINGLE_ARTICLE")),
      sourceUrl: normalizeOptional(String(form.get("sourceUrl") || "")),
      sortOrder: normalizeSortOrder(form.get("sortOrder")),
      publishedAt: status === "PUBLISHED" ? new Date() : null,
      ...(tags.length ? { tags: { connectOrCreate: tags.map((name) => ({ where: { name }, create: { name } })) } } : {})
    }
  });

  if (uploadedImage) {
    // Post 创建后才能拿到 id，因此配图在 create 成功后再插入正文。
    await insertArticleImageFiguresIntoPost(post.id, [
      buildArticleImageFigureHtml({
        src: uploadedImage.url,
        caption: String(form.get("imageCaption") || "").trim() || (imageFile instanceof File ? imageFile.name : "") || "文章配图",
        sourcePageUrl: normalizeOptional(String(form.get("imageSourcePageUrl") || ""))
      })
    ], {
      placement: normalizeArticleImagePlacement(form.get("imageInsertPlacement") || "after-intro"),
      mirrorToEnglish: false
    });
  }

  return redirectTo(`/admin/posts/${post.id}`);
}

function parseTags(raw: string) {
  return [...new Set(raw.split(/[\n,，、;；]/).map((item) => item.trim()).filter(Boolean).slice(0, 12))];
}

function normalizeOptional(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeSortOrder(value: FormDataEntryValue | null) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

function normalizeStatus(value: string): PostStatus {
  if (value === "PUBLISHED" || value === "ARCHIVED" || value === "DRAFT") return value;
  return "DRAFT";
}

function normalizeKind(value: string): CompilationKind {
  if (value === "DAILY_DIGEST" || value === "WEEKLY_ROUNDUP" || value === "SINGLE_ARTICLE") return value;
  return "SINGLE_ARTICLE";
}

async function uniqueSlug(base: string) {
  let slug = base || `post-${Date.now().toString(36)}`;
  let suffix = 1;
  while (await prisma.post.findUnique({ where: { slug } })) {
    suffix += 1;
    slug = `${base}-${suffix}`;
  }
  return slug;
}
