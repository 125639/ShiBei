import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// 作废未使用的邀请码。已用的码绑定着会员登录凭据,不允许作废
// (真要禁用某个会员是另一件事,不该顺手做在这里)。
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin();
  const { id } = await params;

  const code = await prisma.inviteCode.findUnique({ where: { id } });
  if (!code) {
    return NextResponse.json({ error: "邀请码不存在" }, { status: 404 });
  }
  if (code.status === "USED") {
    return NextResponse.json({ error: "该邀请码已被使用，不能作废" }, { status: 409 });
  }

  await prisma.inviteCode.update({ where: { id }, data: { status: "REVOKED" } });
  return NextResponse.json({ ok: true });
}
