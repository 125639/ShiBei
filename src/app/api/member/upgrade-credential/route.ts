import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  normalizeLegacyInvitePasswordCandidate,
  retiredInviteCode
} from "@/lib/invite-codes";
import {
  clearMemberCredentialUpgradeCookie,
  clearMemberSessionCookie,
  getMemberCredentialUpgradeSession
} from "@/lib/member-auth";
import { memberPasswordProblem } from "@/lib/member-credentials";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, checkSubjectRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/request-validation";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ password: z.string().max(100) });

export async function POST(request: Request) {
  const session = await getMemberCredentialUpgradeSession();
  if (!session) {
    await clearMemberCredentialUpgradeCookie();
    return NextResponse.json(
      { error: "密码升级凭据已过期，请重新用旧邀请码验证身份" },
      { status: 401 }
    );
  }

  const limited = await checkRateLimit({
    namespace: "member-credential-upgrade",
    request,
    subject: session.memberId,
    limit: 5,
    windowSec: 15 * 60
  });
  const memberLimited = await checkSubjectRateLimit({
    namespace: "member-credential-upgrade",
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
    select: {
      id: true,
      username: true,
      email: true,
      passwordHash: true,
      tokenVersion: true,
      credentialState: true,
      inviteCode: { select: { id: true, status: true } }
    }
  });
  if (
    !member ||
    member.tokenVersion !== session.tokenVersion ||
    member.credentialState !== "LEGACY_INVITE_UPGRADE_REQUIRED"
  ) {
    await clearMemberCredentialUpgradeCookie();
    return NextResponse.json({ error: "该升级流程已失效，请重新登录" }, { status: 409 });
  }

  const password = parsed.data.password;
  // 历史 hash 保存的是规范邀请码；必须先规范化候选密码再比较，否则仅改大小写、
  // 空格或连字符就能绕过“不可继续使用旧邀请码”的限制。
  const legacyInviteCandidate = normalizeLegacyInvitePasswordCandidate(password);
  if (legacyInviteCandidate && await bcrypt.compare(legacyInviteCandidate, member.passwordHash)) {
    return NextResponse.json({ error: "不能继续使用旧邀请码作为密码" }, { status: 400 });
  }
  const problem = memberPasswordProblem(password, member.username || member.email || undefined);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.memberUser.updateMany({
        where: {
          id: member.id,
          tokenVersion: session.tokenVersion,
          credentialState: "LEGACY_INVITE_UPGRADE_REQUIRED"
        },
        data: {
          passwordHash,
          credentialState: "ACTIVE",
          tokenVersion: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw new Error("UPGRADE_ALREADY_USED");

      if (member.inviteCode?.status === "USED") {
        await tx.inviteCode.update({
          where: { id: member.inviteCode.id },
          data: { code: retiredInviteCode(member.inviteCode.id, "USED") }
        });
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UPGRADE_ALREADY_USED") {
      await clearMemberCredentialUpgradeCookie();
      return NextResponse.json({ error: "该升级流程已使用，请用新密码登录" }, { status: 409 });
    }
    throw error;
  }

  // 设置成功后仍不由旧邀请码链路直接建立会员会话；用户需用新密码重新登录。
  await clearMemberCredentialUpgradeCookie();
  await clearMemberSessionCookie();
  return NextResponse.json({ ok: true, loginRequired: true });
}
