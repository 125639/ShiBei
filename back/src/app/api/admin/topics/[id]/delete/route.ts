import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { removeScheduleByTopicId } from "@/lib/scheduler";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await context.params;

  await removeScheduleByTopicId(id);
  await prisma.newsTopic.delete({ where: { id } }).catch(() => undefined);

  return redirectTo("/admin/auto-curation");
}
