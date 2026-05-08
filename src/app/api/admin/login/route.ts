import bcrypt from "bcryptjs";
import { createSession, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

export async function POST(request: Request) {
  const form = await request.formData();
  const username = String(form.get("username") || "");
  const password = String(form.get("password") || "");

  let user;
  try {
    user = await prisma.adminUser.findUnique({ where: { username } });
  } catch (err) {
    console.error("[login] 数据库查询失败:", err);
    return redirectTo("/admin/login?error=db", request);
  }

  if (!user) {
    console.warn(`[login] 用户不存在: "${username}"`);
    return redirectTo("/admin/login?error=1", request);
  }

  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk) {
    console.warn(`[login] 密码错误: username="${username}"`);
    return redirectTo("/admin/login?error=1", request);
  }

  await setSessionCookie(await createSession(user.id));
  return redirectTo("/admin", request);
}
