import { requireAdmin } from "@/lib/auth";
import { parseBulkTopicIds, setTopicsEnabled } from "@/lib/content-topic-bulk";
import { redirectTo } from "@/lib/redirect";

export async function POST(request: Request) {
  await requireAdmin();
  const ids = parseBulkTopicIds(await request.formData());
  await setTopicsEnabled(ids, false);
  return redirectTo("/admin/auto-curation");
}
