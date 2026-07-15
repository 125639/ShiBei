import { NextResponse } from "next/server";
import {
  clearMemberCredentialUpgradeCookie,
  clearMemberSessionCookie,
  getMemberSession
} from "@/lib/member-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getMemberSession();
  if (session) {
    // 条件更新保证同一旧 token 即使并发登出，也只吊销一次当前版本。
    await prisma.memberUser.updateMany({
      where: { id: session.memberId, tokenVersion: session.tokenVersion },
      data: { tokenVersion: { increment: 1 } }
    });
  }
  await clearMemberSessionCookie();
  await clearMemberCredentialUpgradeCookie();
  return NextResponse.json({ ok: true });
}
