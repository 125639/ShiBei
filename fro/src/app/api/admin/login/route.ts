import bcrypt from "bcryptjs";
import { createSession, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

export async function POST(request: Request) {
  const form = await request.formData();
  const username = String(form.get("username") || "");
  const password = String(form.get("password") || "");
  const user = await prisma.adminUser.findUnique({ where: { username } });

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return redirectTo("/admin/login?error=1", request);
  }

  await setSessionCookie(await createSession(user.id));
  return redirectTo("/admin", request);
}
