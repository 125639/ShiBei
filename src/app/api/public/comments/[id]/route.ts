import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/member-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// 会员删除自己的评论。管理员的删除走 /api/admin/comments。
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const comment = await prisma.comment.findUnique({ where: { id }, select: { memberId: true } });
  if (!comment) {
    return NextResponse.json({ error: "评论不存在" }, { status: 404 });
  }
  if (comment.memberId !== member.id) {
    return NextResponse.json({ error: "只能删除自己的评论" }, { status: 403 });
  }

  await prisma.comment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
