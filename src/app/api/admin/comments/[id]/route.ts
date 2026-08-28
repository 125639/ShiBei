import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin();
  const { id } = await params;

  const comment = await prisma.comment.findUnique({ where: { id }, select: { id: true } });
  if (!comment) {
    return NextResponse.json({ error: "评论不存在" }, { status: 404 });
  }

  await prisma.comment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
