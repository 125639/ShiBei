import { requireAdmin } from "@/lib/auth";
import { redirectTo } from "@/lib/redirect";
import { enqueueTopicRun } from "@/lib/auto-curation";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await context.params;
  await enqueueTopicRun(id);
  return redirectTo("/admin/auto-curation");
}
