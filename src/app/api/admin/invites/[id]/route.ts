import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { retiredInviteCode } from "@/lib/invite-codes";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// 作废未使用的邀请码。邀请码不是会员登录凭据；一旦作废即抹除原码。
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
  if (code.status !== "UNUSED") {
    return NextResponse.json(
      { error: code.status === "USED" ? "该邀请码已被使用，不能作废" : "该邀请码已经作废" },
      { status: 409 }
    );
  }

  // 与注册端的 UNUSED -> USED 条件抢占对称。旧的管理员请求不能在注册事务已经
  // 消费邀请码后，再凭先前读到的 UNUSED 快照把最终状态覆盖成 REVOKED。
  const revoked = await prisma.inviteCode.updateMany({
    where: { id, status: "UNUSED" },
    data: { status: "REVOKED", code: retiredInviteCode(id, "REVOKED") }
  });
  if (revoked.count !== 1) {
    return NextResponse.json({ error: "邀请码刚刚被使用或作废，请刷新后重试" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
