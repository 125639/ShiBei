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
  password: z.string().min(8, "密码至少 8 位").max(100),
  displayName: z.string().trim().max(40).optional().default("")
});

export async function POST(request: Request) {
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
    data: { email, passwordHash, displayName: displayName || null },
    select: { id: true, email: true, displayName: true }
  });

  const claimed = await claimAnonWorks(member.id);
  await setMemberSessionCookie(await createMemberSession(member.id));
  return NextResponse.json({ member, claimedWorks: claimed });
}
