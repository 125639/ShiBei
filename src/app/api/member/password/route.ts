import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  clearMemberCredentialUpgradeCookie,
  clearMemberSessionCookie,
  getMemberSession
} from "@/lib/member-auth";
import { memberPasswordProblem } from "@/lib/member-credentials";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, checkSubjectRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/request-validation";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  currentPassword: z.string().min(1).max(100),
  newPassword: z.string().max(100)
});

export async function POST(request: Request) {
  const session = await getMemberSession();
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const limited = await checkRateLimit({
    namespace: "member-password-change",
    request,
    subject: session.memberId,
    limit: 5,
    windowSec: 15 * 60
  });
  const memberLimited = await checkSubjectRateLimit({
    namespace: "member-password-change",
    subject: session.memberId,
    limit: 5,
    windowSec: 15 * 60
  });
  if (!limited.ok || !memberLimited.ok) {
    return NextResponse.json({ error: "尝试过于频繁，请稍后再试" }, { status: 429 });
  }

  const parsed = await parseJsonBody(request, BodySchema);
  if (!parsed.ok) return parsed.response;

  const member = await prisma.memberUser.findUnique({
    where: { id: session.memberId },
    select: { id: true, username: true, email: true, passwordHash: true, tokenVersion: true }
  });
  if (!member || member.tokenVersion !== session.tokenVersion) {
    return NextResponse.json({ error: "登录已失效，请重新登录" }, { status: 401 });
  }
  if (!(await bcrypt.compare(parsed.data.currentPassword, member.passwordHash))) {
    return NextResponse.json({ error: "当前密码错误" }, { status: 401 });
  }

  const problem = memberPasswordProblem(
    parsed.data.newPassword,
    member.username || member.email || undefined
  );
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  if (await bcrypt.compare(parsed.data.newPassword, member.passwordHash)) {
    return NextResponse.json({ error: "新密码不能与当前密码相同" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  const updated = await prisma.memberUser.updateMany({
    where: { id: member.id, tokenVersion: session.tokenVersion, credentialState: "ACTIVE" },
    data: { passwordHash, tokenVersion: { increment: 1 } }
  });
  if (updated.count !== 1) {
    return NextResponse.json({ error: "登录已失效，请重新登录" }, { status: 409 });
  }

  // 改密后当前及其他设备的旧 JWT 一并失效，要求重新登录。
  await clearMemberSessionCookie();
  await clearMemberCredentialUpgradeCookie();
  return NextResponse.json({ ok: true, loginRequired: true });
}
