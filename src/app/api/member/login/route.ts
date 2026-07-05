import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/request-validation";
import { claimAnonWorks, createMemberSession, setMemberSessionCookie } from "@/lib/member-auth";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(100)
});

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { email, password } = parsed.data;

  const limited = await checkRateLimit({
    namespace: "member-login",
    request,
    subject: email,
    limit: 8,
    windowSec: 15 * 60
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "登录尝试过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
  }

  const member = await prisma.memberUser.findUnique({ where: { email } });
  if (!member || !(await bcrypt.compare(password, member.passwordHash))) {
    return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
  }

  const claimed = await claimAnonWorks(member.id);
  await setMemberSessionCookie(await createMemberSession(member.id));
  return NextResponse.json({
    member: { id: member.id, email: member.email, displayName: member.displayName },
    claimedWorks: claimed
  });
}
