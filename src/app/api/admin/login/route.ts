import bcrypt from "bcryptjs";
import { createSession, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { redirectTo } from "@/lib/redirect";

export async function POST(request: Request) {
  const form = await request.formData();
  const username = String(form.get("username") || "").trim();
  const password = String(form.get("password") || "");
  const limited = await checkRateLimit({
    namespace: "admin-login",
    request,
    subject: username || "blank",
    limit: 8,
    windowSec: 15 * 60
  });
  if (!limited.ok) {
    console.warn("[login] 登录尝试过于频繁，已限速");
    return redirectTo("/admin/login?error=rate", request);
  }

  let user;
  try {
    user = await prisma.adminUser.findUnique({ where: { username } });
  } catch (err) {
    console.error("[login] 数据库查询失败:", err);
    return redirectTo("/admin/login?error=db", request);
  }

  if (!user) {
    console.warn("[login] 用户名或密码错误");
    return redirectTo("/admin/login?error=1", request);
  }

  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk) {
    console.warn("[login] 用户名或密码错误");
    return redirectTo("/admin/login?error=1", request);
  }

  await setSessionCookie(await createSession(user.id));
  return redirectTo("/admin", request);
}
