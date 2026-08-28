import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/request-validation";
import { prisma } from "@/lib/prisma";
import { getClientIp } from "@/lib/creation-server";
import {
  ManualCommunityDraftSchema,
  ManualWritingError,
  ManualWritingHandoffRaceError,
  handoffManualWritingDocument,
  type ManualWorkRecord,
  type ManualWritingDocument
} from "@/lib/manual-writing";
import {
  findOwnedDoc,
  getWritingIdentity,
  identityStrictlyOwnsWritingDoc
} from "@/lib/writing-docs";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function destination(work: ManualWorkRecord) {
  return `/create?work=${encodeURIComponent(work.id)}`;
}

async function loadStrictlyOwnedDocument(id: string) {
  const identity = await getWritingIdentity();
  const doc = await findOwnedDoc(id, identity);
  if (!doc || !identityStrictlyOwnsWritingDoc(doc, identity)) return null;
  return { doc, identity };
}

/**
 * 把已完成的手写文档一次性交接为 MANUAL CreativeWork。
 * 交接本身不调用 AI；用户进入作品页后才能显式点击 AI 评分。
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseJsonBody(request, ManualCommunityDraftSchema);
  if (!parsed.ok) return parsed.response;

  const owned = await loadStrictlyOwnedDocument(id);
  if (!owned) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  const { doc, identity } = owned;

  if (doc.publicationBlockedAt) {
    return NextResponse.json(
      { error: "这份私有原稿仍可继续编辑和导出，但因对应公开副本被内容治理删除，社区交接已锁定。" },
      { status: 409 }
    );
  }

  if (
    !doc.creativeWorkId
    && doc.updatedAt.toISOString() !== parsed.data.expectedUpdatedAt
  ) {
    return NextResponse.json(
      { error: "文档已在其他页面更新，请重新完成并预览最新版本后再继续" },
      { status: 409 }
    );
  }

  if (!doc.creativeWorkId) {
    const genre = await prisma.creationGenre.findUnique({ where: { id: parsed.data.genreId } });
    if (!genre || !genre.isEnabled) {
      return NextResponse.json({ error: "题材不存在或已停用" }, { status: 404 });
    }
  }

  const document: ManualWritingDocument = {
    id: doc.id,
    title: doc.title,
    content: doc.content,
    ownerId: doc.ownerId,
    anonId: doc.anonId,
    creativeWorkId: doc.creativeWorkId,
    publicationBlockedAt: doc.publicationBlockedAt
  };

  try {
    const result = await prisma.$transaction(async (tx) =>
      handoffManualWritingDocument({
        document,
        genreId: parsed.data.genreId,
        depth: parsed.data.depth,
        clientIp: getClientIp(request),
        store: {
          findWork: (workId) => tx.creativeWork.findUnique({
            where: { id: workId },
            select: { id: true, mode: true, status: true, slug: true }
          }),
          createWork: (data) => tx.creativeWork.create({
            data,
            select: { id: true, mode: true, status: true, slug: true }
          }),
          linkDocumentIfUnlinked: async (documentId, workId) => {
            // 所有权条件与 creativeWorkId=null 在同一条 UPDATE 中：
            // 既防止身份在请求中途变化，也让并发交接只有一个胜者。
            const where = identity.memberId
              ? {
                  id: documentId,
                  ownerId: identity.memberId,
                  creativeWorkId: null,
                  publicationBlockedAt: null,
                  updatedAt: new Date(parsed.data.expectedUpdatedAt)
                }
              : {
                  id: documentId,
                  ownerId: null,
                  anonId: identity.anonId as string,
                  creativeWorkId: null,
                  publicationBlockedAt: null,
                  updatedAt: new Date(parsed.data.expectedUpdatedAt)
                };
            const linked = await tx.writingDoc.updateMany({
              where,
              data: { creativeWorkId: workId, completedAt: doc.completedAt ?? new Date() }
            });
            return linked.count === 1;
          }
        }
      })
    );

    return NextResponse.json({
      workId: result.work.id,
      status: result.work.status,
      created: result.created,
      url: destination(result.work)
    });
  } catch (error) {
    if (error instanceof ManualWritingHandoffRaceError) {
      // 事务已整体回滚（包括本请求创建的作品）。重读文档取胜者，
      // 不会留下孤儿 CreativeWork。
      const winner = await loadStrictlyOwnedDocument(id);
      if (winner?.doc.publicationBlockedAt) {
        return NextResponse.json(
          { error: "这份私有原稿仍可继续编辑和导出，但社区交接已被内容治理锁定。" },
          { status: 409 }
        );
      }
      const winnerId = winner?.doc.creativeWorkId;
      const work = winnerId
        ? await prisma.creativeWork.findUnique({
            where: { id: winnerId },
            select: { id: true, mode: true, status: true, slug: true }
          })
        : null;
      if (work?.mode === "MANUAL") {
        return NextResponse.json({
          workId: work.id,
          status: work.status,
          created: false,
          url: destination(work)
        });
      }
      return NextResponse.json({ error: "文档交接发生冲突，请重试" }, { status: 409 });
    }
    if (error instanceof ManualWritingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[manual-writing-handoff] failed:", error);
    return NextResponse.json({ error: "无法进入评分与发布流程，请稍后重试" }, { status: 500 });
  }
}
