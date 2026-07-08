import bcrypt from "bcryptjs";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const username = String(form.get("username") || "admin");
  const password = String(form.get("password") || "");
  const admin = await prisma.adminUser.findFirst({ orderBy: { createdAt: "asc" } });

  if (admin) {
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        username,
        // 改密同时递增 tokenVersion，令旧密码签发的 JWT 立即失效（改密常因凭据泄露）。
        ...(password ? { passwordHash: await bcrypt.hash(password, 12), tokenVersion: { increment: 1 } } : {})
      }
    });
  }

  return redirectTo("/admin/settings?tab=account&saved=1");
}
