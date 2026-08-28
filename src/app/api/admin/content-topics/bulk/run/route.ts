import { requireAdmin } from "@/lib/auth";
import { parseBulkTopicIds, runTopics } from "@/lib/content-topic-bulk";
import { redirectTo } from "@/lib/redirect";

export async function POST(request: Request) {
  await requireAdmin();
  const ids = parseBulkTopicIds(await request.formData());
  await runTopics(ids);
  return redirectTo("/admin/auto-curation");
}
