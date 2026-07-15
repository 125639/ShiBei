import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import {
  assessPostPublicationRequest,
  extractResearchSourceUrls,
  requiresGeneratedArticleGate
} from "@/lib/post-publication";
import { prisma } from "@/lib/prisma";
import { generationPublicationBlockReason } from "@/lib/publication-policy";
import { revalidatePublicContent } from "@/lib/revalidate-public";
import { redirectTo } from "@/lib/redirect";

const VALID_ACTIONS = new Set(["delete", "publish", "draft", "archive"]);

class BulkPublishBlockedError extends Error {
  constructor(readonly blockedCount: number, readonly code = "blocked") {
    super("bulk publication contains blocked posts");
  }
}

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const ids = [...new Set(form.getAll("postId").map(String).filter(Boolean))];
  const action = String(form.get("action") || "delete");

  // 白名单校验：意料之外的 action 不能落到 else 分支里被当成删除执行。
  if (!VALID_ACTIONS.has(action)) {
    return redirectTo("/admin/posts");
  }

  if (ids.length) {
    // 事务包裹：查 slug 与批量更新要么全部生效要么全部回滚，
    // 避免中途失败导致部分文章已改状态但缓存未刷新。
    let affected: Array<{ slug: string }>;
    try {
      affected = await prisma.$transaction(async (tx) => {
        // Lock the exact rows before reading the fields that the publication
        // gate evaluates. Otherwise a concurrent editor could replace content
        // after assessment and have that unassessed version published by the
        // subsequent updateMany.
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Post"
          WHERE "id" IN (${Prisma.join(ids)})
          ORDER BY "id"
          FOR UPDATE
        `);
        const posts = await tx.post.findMany({
          where: { id: { in: ids } },
          select: {
            slug: true,
            rawItemId: true,
            publicationBlockedReason: true,
            pendingRevision: true,
            title: true,
            summary: true,
            content: true,
            sourceUrl: true,
            rawItem: {
              select: {
                markdown: true,
                url: true,
                artifactKind: true,
                fetchJob: { select: { sourceType: true } }
              }
            }
          }
        });
        if (action !== "delete") {
          const pendingCount = posts.filter((post) => post.pendingRevision !== null).length;
          if (pendingCount) throw new BulkPublishBlockedError(pendingCount, "pending_revision");
        }
        if (action === "publish") {
          const blockedCount = posts.filter((post) => {
            const generatedArticle = requiresGeneratedArticleGate({
              hasRawItem: Boolean(post.rawItemId),
              artifactKind: post.rawItem?.artifactKind,
              sourceType: post.rawItem?.fetchJob?.sourceType
            });
            return generationPublicationBlockReason({ ...post, generatedArtifact: generatedArticle });
          }).length;
          if (blockedCount) throw new BulkPublishBlockedError(blockedCount);

          const failedGateCount = posts.filter((post) => {
            const generatedArticle = requiresGeneratedArticleGate({
              hasRawItem: Boolean(post.rawItemId),
              artifactKind: post.rawItem?.artifactKind,
              sourceType: post.rawItem?.fetchJob?.sourceType
            });
            return !assessPostPublicationRequest({
              requestedStatus: "PUBLISHED",
              publicationBlockedReason: post.publicationBlockedReason,
              title: post.title,
              summary: post.summary,
              content: post.content,
              generatedArtifact: generatedArticle,
              allowedSourceUrls: [
                ...extractResearchSourceUrls(post.rawItem?.markdown, post.rawItem?.url),
                ...(post.sourceUrl && /^https?:\/\//i.test(post.sourceUrl) ? [post.sourceUrl] : [])
              ]
            }).ok;
          }).length;
          if (failedGateCount) throw new BulkPublishBlockedError(failedGateCount);

          const now = new Date();
          const newlyPublished = await tx.post.updateMany({
            where: { id: { in: ids }, publicationBlockedReason: null, publishedAt: null },
            data: { status: "PUBLISHED", publishedAt: now }
          });
          const republished = await tx.post.updateMany({
            where: { id: { in: ids }, publicationBlockedReason: null, publishedAt: { not: null } },
            data: { status: "PUBLISHED" }
          });
          // The WHERE clause is a second line of defence against a worker that
          // writes a block after the read. Any mismatch aborts and rolls back
          // the whole batch, so publication remains all-or-nothing.
          if (newlyPublished.count + republished.count !== posts.length) {
            throw new BulkPublishBlockedError(Math.max(1, posts.length - newlyPublished.count - republished.count));
          }
        } else if (action === "draft") {
          await tx.post.updateMany({ where: { id: { in: ids } }, data: { status: "DRAFT", publishedAt: null } });
        } else if (action === "archive") {
          await tx.post.updateMany({ where: { id: { in: ids } }, data: { status: "ARCHIVED" } });
        } else {
          await tx.post.deleteMany({
            where: { id: { in: ids } }
          });
        }
        return posts.map(({ slug }) => ({ slug }));
      });
    } catch (error) {
      if (error instanceof BulkPublishBlockedError) {
        return redirectTo(`/admin/posts?publishError=${error.code}&blockedCount=${error.blockedCount}`, request);
      }
      throw error;
    }
    revalidatePublicContent(affected.map((post) => `/posts/${post.slug}`));
  }

  return redirectTo("/admin/posts");
}
