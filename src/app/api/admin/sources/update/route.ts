import { requireAdmin } from "@/lib/auth";
import { normalizePopularity } from "@/lib/form-number";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const sourceId = String(form.get("sourceId") || "");
  const popularity = normalizePopularity(form.get("popularity"));

  if (sourceId) {
    await prisma.source.update({
      where: { id: sourceId },
      data: { popularity, popularityUpdatedAt: new Date() }
    });
  }

  return redirectTo("/admin/sources");
}
