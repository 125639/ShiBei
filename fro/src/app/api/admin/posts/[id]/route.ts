import { PostStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const form = await request.formData();
  const status = normalizeStatus(String(form.get("status") || "DRAFT"));
  const tags = parseTags(String(form.get("tags") || ""));

  const existing = await prisma.post.findUniqueOrThrow({ where: { id }, include: { tags: true } });

  await prisma.post.update({
    where: { id },
    data: {
      title: String(form.get("title") || "未命名"),
      titleEn: normalizeOptional(String(form.get("titleEn") || "")),
      summary: String(form.get("summary") || ""),
      summaryEn: normalizeOptional(String(form.get("summaryEn") || "")),
      content: String(form.get("content") || ""),
      contentEn: normalizeOptional(String(form.get("contentEn") || "")),
      sourceUrl: normalizeOptional(String(form.get("sourceUrl") || "")),
      sortOrder: normalizeSortOrder(form.get("sortOrder")),
      status,
      publishedAt: status === "PUBLISHED" ? existing.publishedAt || new Date() : null,
      tags: {
        set: [],
        connectOrCreate: tags.map((name) => ({ where: { name }, create: { name } }))
      }
    }
  });

  return redirectTo(`/admin/posts/${id}`);
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
