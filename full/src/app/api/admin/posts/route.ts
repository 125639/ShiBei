import { CompilationKind, PostStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { slugify } from "@/lib/slug";

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const title = String(form.get("title") || "未命名文章").trim() || "未命名文章";
  const status = normalizeStatus(String(form.get("status") || "DRAFT"));
  const slugBase = slugify(String(form.get("slug") || title));
  const slug = await uniqueSlug(slugBase);
  const tags = parseTags(String(form.get("tags") || ""));

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
