import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseJsonBody } from "@/lib/request-validation";
import { MAX_WRITING_DOC_CONTENT_LENGTH } from "@/lib/creation-limits";
import {
  deletableWritingDocRevisionWhere,
  editableWritingDocRevisionWhere,
  findOwnedDoc,
  getWritingIdentity,
  serializeWritingDoc
} from "@/lib/writing-docs";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  title: z.string().max(300).optional(),
  content: z.string().max(MAX_WRITING_DOC_CONTENT_LENGTH, "文档过大").optional()
});

const DeleteSchema = z.object({ expectedUpdatedAt: z.string().datetime() });

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const doc = await findOwnedDoc(id, await getWritingIdentity());
  if (!doc) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  return NextResponse.json({
    doc: serializeWritingDoc(doc)
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const identity = await getWritingIdentity();
  const doc = await findOwnedDoc(id, identity);
  if (!doc) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  if (doc.creativeWorkId) {
    return NextResponse.json(
      { error: "这份手写文档已进入评分与发布流程，请在作品草稿中继续修改" },
      { status: 409 }
    );
  }

  const parsed = await parseJsonBody(request, PatchSchema);
  if (!parsed.ok) return parsed.response;
  const expectedUpdatedAt = new Date(parsed.data.expectedUpdatedAt);
  if (parsed.data.title === undefined && parsed.data.content === undefined) {
    if (doc.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      return NextResponse.json({ error: "文档已在其他页面更新，请刷新后重试" }, { status: 409 });
    }
    return NextResponse.json({ doc: serializeWritingDoc(doc) });
  }

  const claimed = await prisma.writingDoc.updateMany({
    where: editableWritingDocRevisionWhere(doc, identity, expectedUpdatedAt),
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title.trim().slice(0, 300) } : {}),
      ...(parsed.data.content !== undefined ? { content: parsed.data.content } : {}),
      // 完成后又修改就回到未完成状态；不触碰已交接的 CreativeWork。
      ...(
        parsed.data.title !== undefined || parsed.data.content !== undefined
          ? { completedAt: null }
          : {}
      )
    }
  });
  if (claimed.count === 0) {
    return NextResponse.json(
      { error: "文档已在其他页面更新或进入评分与发布流程，请刷新后重试" },
      { status: 409 }
    );
  }
  const updated = await findOwnedDoc(doc.id, identity);
  if (!updated) {
    return NextResponse.json({ error: "文档已发生变化，请刷新后重试" }, { status: 409 });
  }
  return NextResponse.json({
    doc: serializeWritingDoc(updated)
  });
}

// sendBeacon 只能发 POST:页面卸载前的兜底保存走这里,语义同 PATCH。
export async function POST(request: Request, ctx: Params) {
  return PATCH(request, ctx);
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const identity = await getWritingIdentity();
  const doc = await findOwnedDoc(id, identity);
  if (!doc) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  const parsed = await parseJsonBody(request, DeleteSchema);
  if (!parsed.ok) return parsed.response;
  const deleted = await prisma.writingDoc.deleteMany({
    where: deletableWritingDocRevisionWhere(doc, identity, new Date(parsed.data.expectedUpdatedAt))
  });
  if (deleted.count === 0) {
    return NextResponse.json(
      { error: "文档已在其他页面更新，请刷新后重试" },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true });
}
