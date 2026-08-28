import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { slugify } from "@/lib/slug";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const form = await request.formData();
  const name = String(form.get("name") || "").trim();
  const slug = slugify(String(form.get("slug") || name));
  const description = String(form.get("description") || "").trim() || null;
  const rawColor = String(form.get("color") || "#9f4f2f").trim();
  const color = /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : "#9f4f2f";
  const rawSortOrder = Number(form.get("sortOrder") || 0);

  if (!name || !slug) return redirectTo("/admin/modules?error=invalid-module");

  try {
    await prisma.sourceModule.update({
      where: { id },
      data: {
        name,
        slug,
        description,
        color,
        sortOrder: Number.isFinite(rawSortOrder) ? Math.trunc(rawSortOrder) : 0
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // 名称/别名唯一冲突（P2002）或模块已被删除（P2025）：回列表页给出
      // 可读提示，而不是抛出未处理的 500 错误页。
      if (error.code === "P2002") return redirectTo("/admin/modules?error=duplicate-module");
      if (error.code === "P2025") return redirectTo("/admin/modules?error=missing-module");
    }
    throw error;
  }
  return redirectTo("/admin/modules");
}
