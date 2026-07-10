import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseJsonBody } from "@/lib/request-validation";
import { findOwnedDoc, getWritingIdentity } from "@/lib/writing-docs";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  title: z.string().max(300).optional(),
  content: z.string().max(200_000, "文档过大").optional()
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const doc = await findOwnedDoc(id, await getWritingIdentity());
  if (!doc) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  return NextResponse.json({
    doc: { id: doc.id, title: doc.title, content: doc.content, updatedAt: doc.updatedAt.toISOString() }
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const doc = await findOwnedDoc(id, await getWritingIdentity());
  if (!doc) return NextResponse.json({ error: "文档不存在" }, { status: 404 });

  const parsed = await parseJsonBody(request, PatchSchema);
  if (!parsed.ok) return parsed.response;

  const updated = await prisma.writingDoc.update({
    where: { id: doc.id },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title.trim().slice(0, 300) } : {}),
      ...(parsed.data.content !== undefined ? { content: parsed.data.content } : {})
    }
  });
  return NextResponse.json({
    doc: { id: updated.id, title: updated.title, updatedAt: updated.updatedAt.toISOString() }
  });
}

// sendBeacon 只能发 POST:页面卸载前的兜底保存走这里,语义同 PATCH。
export async function POST(request: Request, ctx: Params) {
  return PATCH(request, ctx);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const doc = await findOwnedDoc(id, await getWritingIdentity());
  if (!doc) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  await prisma.writingDoc.delete({ where: { id: doc.id } });
  return NextResponse.json({ ok: true });
}
