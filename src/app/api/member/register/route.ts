import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/request-validation";
import {
  clearMemberCredentialUpgradeCookie,
  createMemberSession,
  setMemberSessionCookie
} from "@/lib/member-auth";
import { memberPasswordProblem, publicMemberRegistrationEnabled } from "@/lib/member-credentials";

export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().max(100),
    displayName: z.string().trim().max(40).optional().default("")
  })
  .superRefine((data, ctx) => {
    const problem = memberPasswordProblem(data.password, data.email);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["password"], message: problem });
  });

export async function POST(request: Request) {
  // 默认邀请制：未明确开启 feature flag 时，连未在 UI 暴露的旧 API 旁路也封闭。
  if (!publicMemberRegistrationEnabled()) {
    return NextResponse.json({ error: "会员注册仅限管理员邀请码" }, { status: 404 });
  }

  const limited = await checkRateLimit({
    namespace: "member-register",
    request,
    limit: 5,
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
  const { email, password, displayName } = parsed.data;

  const existing = await prisma.memberUser.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return NextResponse.json({ error: "该邮箱已注册，请直接登录" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const member = await prisma.memberUser.create({
    data: { email, passwordHash, displayName: displayName || null, credentialState: "ACTIVE" },
    select: { id: true, email: true, username: true, displayName: true, tokenVersion: true }
  });

  await clearMemberCredentialUpgradeCookie();
  await setMemberSessionCookie(await createMemberSession(member.id, member.tokenVersion));
  return NextResponse.json({
    member: {
      id: member.id,
      email: member.email,
      username: member.username,
      displayName: member.displayName
    }
  });
}
