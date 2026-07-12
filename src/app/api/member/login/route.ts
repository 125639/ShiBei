import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isInviteCodeFormat, normalizeInviteCodeInput } from "@/lib/invite-codes";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, checkSubjectRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/request-validation";
import { claimAnonWorks, createMemberSession, setMemberSessionCookie } from "@/lib/member-auth";

export const dynamic = "force-dynamic";

// 统一登录:邮箱会员用 邮箱+密码,邀请码会员用 用户名+邀请码。
// account/secret 是新字段;email/password 保留兼容旧客户端。
const BodySchema = z
  .object({
    account: z.string().trim().min(2).max(254).optional(),
    secret: z.string().min(1).max(100).optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    password: z.string().min(1).max(100).optional()
  })
  .refine((data) => (data.account || data.email) && (data.secret || data.password), {
    message: "缺少账号或密码"
  });

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, BodySchema);
  if (!parsed.ok) return parsed.response;
  const account = (parsed.data.account || parsed.data.email || "").trim();
  const secret = parsed.data.secret || parsed.data.password || "";

  const limited = await checkRateLimit({
    namespace: "member-login",
    request,
    subject: account.toLowerCase(),
    limit: 8,
    windowSec: 15 * 60
  });
  const accountLimited = await checkSubjectRateLimit({
    namespace: "member-login",
    subject: account.toLowerCase(),
    limit: 8,
    windowSec: 15 * 60
  });
  if (!limited.ok || !accountLimited.ok) {
    return NextResponse.json(
      { error: "登录尝试过于频繁，请稍后再试" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.max(
            limited.ok ? 0 : limited.retryAfterSec,
            accountLimited.ok ? 0 : accountLimited.retryAfterSec
          ))
        }
      }
    );
  }

  const member = account.includes("@")
    ? await prisma.memberUser.findUnique({ where: { email: account.toLowerCase() } })
    : await prisma.memberUser.findUnique({ where: { username: account } });

  let ok = member ? await bcrypt.compare(secret, member.passwordHash) : false;
  // 邀请码大小写/连字符宽容:按规范格式再试一次
  if (!ok && member) {
    const normalized = normalizeInviteCodeInput(secret);
    if (normalized !== secret && isInviteCodeFormat(normalized)) {
      ok = await bcrypt.compare(normalized, member.passwordHash);
    }
  }
  if (!member || !ok) {
    return NextResponse.json({ error: "账号或密码（邀请码）错误" }, { status: 401 });
  }

  const claimed = await claimAnonWorks(member.id);
  await setMemberSessionCookie(await createMemberSession(member.id));
  return NextResponse.json({
    member: { id: member.id, email: member.email, username: member.username, displayName: member.displayName },
    claimedWorks: claimed
  });
}
