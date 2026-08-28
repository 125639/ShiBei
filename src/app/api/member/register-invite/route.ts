import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeInviteCodeInput, retiredInviteCode } from "@/lib/invite-codes";
import {
  clearMemberCredentialUpgradeCookie,
  createMemberSession,
  setMemberSessionCookie
} from "@/lib/member-auth";
import { memberPasswordProblem } from "@/lib/member-credentials";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/request-validation";

export const dynamic = "force-dynamic";

// 邀请码只完成一次性开户；真正的长期凭据必须由用户自己设置。
const BodySchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(2, "用户名至少 2 个字符")
      .max(24, "用户名最多 24 个字符")
      .regex(/^[\w一-龥-]+$/u, "用户名只能包含中英文、数字、下划线或连字符"),
    code: z.string().trim().min(6, "邀请码格式不对").max(40),
    password: z.string().max(100)
  })
  .superRefine((data, ctx) => {
    const problem = memberPasswordProblem(data.password, data.username);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["password"], message: problem });
    if (normalizeInviteCodeInput(data.password) === normalizeInviteCodeInput(data.code)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["password"],
        message: "密码不能与邀请码相同"
      });
    }
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
  const password = parsed.data.password;

  const invite = await prisma.inviteCode.findUnique({ where: { code } });
  if (!invite || invite.status !== "UNUSED") {
    return NextResponse.json({ error: "邀请码无效或已被使用" }, { status: 400 });
  }

  const usernameTaken = await prisma.memberUser.findUnique({ where: { username }, select: { id: true } });
  if (usernameTaken) {
    return NextResponse.json({ error: "该用户名已被占用，换一个试试" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  let member;
  try {
    member = await prisma.$transaction(async (tx) => {
      // 条件更新挡并发:两个请求抢同一个码,只有一个能把 UNUSED 翻成 USED
      const claimed = await tx.inviteCode.updateMany({
        where: { id: invite.id, status: "UNUSED" },
        data: {
          code: retiredInviteCode(invite.id, "USED"),
          status: "USED",
          usedAt: new Date()
        }
      });
      if (claimed.count === 0) throw new Error("INVITE_TAKEN");
      const created = await tx.memberUser.create({
        data: { username, passwordHash, credentialState: "ACTIVE" },
        select: { id: true, username: true, email: true, displayName: true, tokenVersion: true }
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

  await clearMemberCredentialUpgradeCookie();
  await setMemberSessionCookie(await createMemberSession(member.id, member.tokenVersion));
  return NextResponse.json({
    member: {
      id: member.id,
      username: member.username,
      email: member.email,
      displayName: member.displayName
    }
  });
}
