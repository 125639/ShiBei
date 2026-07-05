import { requireAdmin } from "@/lib/auth";
import { deleteTopics, parseBulkTopicIds } from "@/lib/content-topic-bulk";
import { redirectTo } from "@/lib/redirect";

export async function POST(request: Request) {
  await requireAdmin();
  const ids = parseBulkTopicIds(await request.formData());
  await deleteTopics(ids);
  return redirectTo("/admin/auto-curation");
}
