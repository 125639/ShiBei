import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  findOwnedDoc,
  getWritingIdentity,
  identityStrictlyOwnsWritingDoc,
  serializeWritingDoc
} from "@/lib/writing-docs";
import { ManualWritingError, validateManualWritingPreview } from "@/lib/manual-writing";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 明确完成手写草稿并固化完成时间。这一步只读写数据库，
 * 不调用 AI，也不会自动公开内容。
 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const identity = await getWritingIdentity();
  const doc = await findOwnedDoc(id, identity);
  if (!doc || !identityStrictlyOwnsWritingDoc(doc, identity)) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }

  // 交接后 CreativeWork 是唯一继续编辑源，重复点完成不回写原文或作品。
  if (doc.creativeWorkId) {
    return NextResponse.json({ doc: serializeWritingDoc(doc), alreadySubmitted: true });
  }

  try {
    validateManualWritingPreview(doc);
  } catch (error) {
    if (error instanceof ManualWritingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const ownershipWhere = identity.memberId
    ? { id: doc.id, ownerId: identity.memberId, creativeWorkId: null, updatedAt: doc.updatedAt }
    : {
        id: doc.id,
        ownerId: null,
        anonId: identity.anonId as string,
        creativeWorkId: null,
        updatedAt: doc.updatedAt
      };
  const completed = await prisma.writingDoc.updateMany({
    where: ownershipWhere,
    data: { completedAt: doc.completedAt ?? new Date() }
  });
  if (completed.count !== 1) {
    return NextResponse.json({ error: "文档刚刚在其他页面发生了变化，请刷新后重试" }, { status: 409 });
  }
  const updated = await prisma.writingDoc.findUniqueOrThrow({ where: { id: doc.id } });
  return NextResponse.json({ doc: serializeWritingDoc(updated), alreadySubmitted: false });
}
