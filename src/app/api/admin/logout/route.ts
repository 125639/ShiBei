import { clearSessionCookie, getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

export async function POST() {
  const session = await getSession();
  if (session) {
    // 递增 tokenVersion，令该用户所有设备上已签发的 JWT 立即失效（不止清本机 cookie）。
    await prisma.adminUser
      .update({ where: { id: session.userId }, data: { tokenVersion: { increment: 1 } } })
      .catch((err) => console.error("[logout] tokenVersion 递增失败:", err));
  }
  await clearSessionCookie();
  return redirectTo("/admin/login");
}
