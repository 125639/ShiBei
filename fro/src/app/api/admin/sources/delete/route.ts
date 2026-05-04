import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const ids = [...new Set(form.getAll("sourceId").map(String).filter(Boolean))];

  if (ids.length) {
    await prisma.source.deleteMany({
      where: { id: { in: ids } }
    });
  }

  return redirectTo("/admin/sources");
}
