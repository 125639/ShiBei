import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeInviteCodeInput } from "@/lib/invite-codes";
import { claimAnonWorks, createMemberSession, setMemberSessionCookie } from "@/lib/member-auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/request-validation";

export const dynamic = "force-dynamic";

// 邀请码注册:只需用户名 + 邀请码,不收邮箱。
// 邀请码经 bcrypt 存为 passwordHash——它同时就是该用户之后的登录凭据。
const BodySchema = z.object({
  username: z
    .string()
    .trim()
    .min(2, "用户名至少 2 个字符")
    .max(24, "用户名最多 24 个字符")
    .regex(/^[\w一-龥-]+$/u, "用户名只能包含中英文、数字、下划线或连字符"),
  code: z.string().trim().min(6, "邀请码格式不对").max(40)
});

export async function POST(request: Request) {
  const limited = await checkRateLimit({
    namespace: "member-register-invite",
    request,
    limit: 8,
    windowSec: 60 * 60
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "注册请求过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
  }

  const parsed = await parseJsonBody(request, BodySchema);
  if (!parsed.ok) return parsed.response;
  const username = parsed.data.username;
  const code = normalizeInviteCodeInput(parsed.data.code);

  const invite = await prisma.inviteCode.findUnique({ where: { code } });
  if (!invite || invite.status !== "UNUSED") {
    return NextResponse.json({ error: "邀请码无效或已被使用" }, { status: 400 });
  }

  const usernameTaken = await prisma.memberUser.findUnique({ where: { username }, select: { id: true } });
  if (usernameTaken) {
    return NextResponse.json({ error: "该用户名已被占用，换一个试试" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(code, 12);
  let member;
  try {
    member = await prisma.$transaction(async (tx) => {
      // 条件更新挡并发:两个请求抢同一个码,只有一个能把 UNUSED 翻成 USED
      const claimed = await tx.inviteCode.updateMany({
        where: { id: invite.id, status: "UNUSED" },
        data: { status: "USED", usedAt: new Date() }
      });
      if (claimed.count === 0) throw new Error("INVITE_TAKEN");
      const created = await tx.memberUser.create({
        data: { username, passwordHash },
        select: { id: true, username: true, email: true, displayName: true }
      });
      await tx.inviteCode.update({ where: { id: invite.id }, data: { memberId: created.id } });
      return created;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INVITE_TAKEN") {
      return NextResponse.json({ error: "邀请码无效或已被使用" }, { status: 400 });
    }
    // 用户名唯一约束竞态兜底
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "该用户名已被占用，换一个试试" }, { status: 409 });
    }
    throw error;
  }

  const claimed = await claimAnonWorks(member.id);
  await setMemberSessionCookie(await createMemberSession(member.id));
  return NextResponse.json({ member, claimedWorks: claimed });
}
