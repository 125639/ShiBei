import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const sourceId = String(form.get("sourceId") || "");
  const rawPopularity = Number(form.get("popularity")) || 0;
  const popularity = Math.max(0, Math.min(rawPopularity, 2147483647));

  if (sourceId) {
    await prisma.source.update({
      where: { id: sourceId },
      data: { popularity, popularityUpdatedAt: new Date() }
    });
  }

  return redirectTo("/admin/sources");
}
