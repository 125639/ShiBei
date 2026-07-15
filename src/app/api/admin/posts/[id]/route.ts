import { PostStatus, Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { normalizeSortOrder } from "@/lib/form-number";
import {
  assessPostPublicationRequest,
  extractResearchSourceUrls,
  requiresGeneratedArticleGate
} from "@/lib/post-publication";
import { prisma } from "@/lib/prisma";
import {
  generationPublicationBlockReason,
  stripNonPublishableGenerationMarker
} from "@/lib/publication-policy";
import { revalidatePublicContent } from "@/lib/revalidate-public";
import { redirectTo } from "@/lib/redirect";
import { failedPublicationStorage } from "@/lib/post-revision";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const form = await request.formData();
  const intent = String(form.get("_intent") || "");
  const requestedStatus = normalizeStatus(String(form.get("status") || "DRAFT"));
  const expectedUpdatedAt = String(form.get("expectedUpdatedAt") || "");
  const tags = parseTags(String(form.get("tags") || ""));
  const title = String(form.get("title") || "未命名");
  const titleEn = normalizeOptional(String(form.get("titleEn") || ""));
  const summary = String(form.get("summary") || "");
  const summaryEn = normalizeOptional(String(form.get("summaryEn") || ""));
  const content = String(form.get("content") || "");
  const contentEn = normalizeOptional(String(form.get("contentEn") || ""));
  const sourceUrl = normalizeOptional(String(form.get("sourceUrl") || ""));

  const existing = await prisma.post.findUniqueOrThrow({
    where: { id },
    select: {
      publishedAt: true,
      status: true,
      updatedAt: true,
      slug: true,
      publicationBlockedReason: true,
      rawItem: {
        select: {
          id: true,
          artifactKind: true,
          markdown: true,
          url: true,
          fetchJob: { select: { sourceType: true } }
        }
      }
    }
  });
  if (expectedUpdatedAt !== existing.updatedAt.toISOString()) {
    return redirectTo(`/admin/posts/${id}?editConflict=1`, request);
  }
  if (existing.status === "PUBLISHED" && intent !== "save_pending" && intent !== "publish_revision") {
    return redirectTo(`/admin/posts/${id}?editIntentError=1`, request);
  }
  const status: PostStatus = existing.status === "PUBLISHED" ? "PUBLISHED" : requestedStatus;
  const generatedArticle = requiresGeneratedArticleGate({
    hasRawItem: Boolean(existing.rawItem),
    artifactKind: existing.rawItem?.artifactKind,
    sourceType: existing.rawItem?.fetchJob?.sourceType
  });

  const buildDraftRevision = (gateReason: string) => ({
    title,
    titleEn,
    summary,
    summaryEn,
    content: stripNonPublishableGenerationMarker(content),
    contentEn,
    sourceUrl,
    sortOrder: normalizeSortOrder(form.get("sortOrder")),
    tags,
    gateReason: gateReason.slice(0, 500),
    savedAt: new Date().toISOString()
  });

  if (existing.status === "PUBLISHED" && intent === "save_pending") {
    const updated = await updatePostAtRevision(id, existing.updatedAt, {
      pendingRevision: buildDraftRevision("待管理员执行发布检查")
    });
    if (!updated) return redirectTo(`/admin/posts/${id}?editConflict=1`, request);
    return redirectTo(`/admin/posts/${id}?revisionSaved=1`, request);
  }

  const publicationAssessment = assessPostPublicationRequest({
    requestedStatus: status,
    publicationBlockedReason: existing.publicationBlockedReason,
    title,
    summary,
    content,
    // RawItem evidence remains the default whitelist. An administrator may
    // explicitly replace/add one reviewed primary source in this form; unlike
    // links copied into the article body, this dedicated field is an editorial
    // approval and can therefore unblock a legacy research draft.
    allowedSourceUrls: [
      ...extractResearchSourceUrls(existing.rawItem?.markdown, existing.rawItem?.url),
      ...(sourceUrl && /^https?:\/\//i.test(sourceUrl) ? [sourceUrl] : [])
    ],
    generatedArtifact: generatedArticle
  });
  if (!publicationAssessment.ok) {
    const draftRevision = buildDraftRevision(publicationAssessment.reason);
    if (failedPublicationStorage(existing.status) === "pending") {
      // A failed edit must not replace or unpublish the version readers can
      // already see. Keep the live row intact and retain the administrator's
      // complete form as a pending revision for the next review attempt.
      const updated = await updatePostAtRevision(id, existing.updatedAt, { pendingRevision: draftRevision });
      if (!updated) return redirectTo(`/admin/posts/${id}?editConflict=1`, request);
      const reason = encodeURIComponent(`${publicationAssessment.reason}；线上原版本未变，本次修改已保存为待审核版本`.slice(0, 240));
      return redirectTo(`/admin/posts/${id}?publishError=blocked&draftSaved=pending&publishReason=${reason}`, request);
    }

    // 发布门禁失败不能把管理员刚完成的长文改写全部丢掉。阻断发布的同时把
    // 尚未公开的本次字段安全保存为草稿。结构化阻断仍保留，下一次发布会
    // 重新执行相同检查。
    const failedBlockReason = generationPublicationBlockReason({
      summary,
      content,
      generatedArtifact: generatedArticle
    }) || publicationAssessment.reason;
    const updated = await updatePostAtRevision(id, existing.updatedAt, {
        title,
        titleEn,
        summary,
        summaryEn,
        content: stripNonPublishableGenerationMarker(content),
        contentEn,
        sourceUrl,
        sortOrder: normalizeSortOrder(form.get("sortOrder")),
        status: "DRAFT",
        publishedAt: null,
        publicationBlockedReason: failedBlockReason,
        tags: {
          set: [],
          connectOrCreate: tags.map((name) => ({ where: { name }, create: { name } }))
        }
    });
    if (!updated) return redirectTo(`/admin/posts/${id}?editConflict=1`, request);
    revalidatePublicContent([`/posts/${existing.slug}`]);
    const reason = encodeURIComponent(`${publicationAssessment.reason}；本次修改已保存为草稿`.slice(0, 240));
    return redirectTo(`/admin/posts/${id}?publishError=blocked&draftSaved=1&publishReason=${reason}`, request);
  }
  const detectedBlock = generationPublicationBlockReason({
    summary,
    content,
    generatedArtifact: generatedArticle
  });
  const publicationBlockedReason = publicationAssessment.clearPublicationBlock
    ? null
    : existing.publicationBlockedReason || detectedBlock;
  const savedContent = publicationAssessment.clearPublicationBlock
    ? stripNonPublishableGenerationMarker(content)
    : content;

  const updated = await updatePostAtRevision(id, existing.updatedAt, {
      title,
      titleEn,
      summary,
      summaryEn,
      content: savedContent,
      contentEn,
      sourceUrl,
      sortOrder: normalizeSortOrder(form.get("sortOrder")),
      status,
      publishedAt: status === "PUBLISHED" ? existing.publishedAt || new Date() : null,
      publicationBlockedReason,
      pendingRevision: Prisma.DbNull,
      tags: {
        set: [],
        connectOrCreate: tags.map((name) => ({ where: { name }, create: { name } }))
      }
  });
  if (!updated) return redirectTo(`/admin/posts/${id}?editConflict=1`, request);

  revalidatePublicContent([`/posts/${existing.slug}`]);
  return redirectTo(`/admin/posts/${id}`);
}

function parseTags(raw: string) {
  return [...new Set(raw.split(/[\n,，、;；]/).map((item) => item.trim()).filter(Boolean).slice(0, 12))];
}

function normalizeOptional(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeStatus(value: string): PostStatus {
  if (value === "PUBLISHED" || value === "ARCHIVED" || value === "DRAFT") return value;
  return "DRAFT";
}

async function updatePostAtRevision(id: string, updatedAt: Date, data: Prisma.PostUpdateInput) {
  try {
    await prisma.post.update({ where: { id, updatedAt }, data });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return false;
    throw error;
  }
}
