import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { getAudienceQueue } from "@/lib/queue";
import { buildAudienceEstimateUrl } from "@/lib/audience";

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const ids = [...new Set(form.getAll("sourceId").map(String).filter(Boolean))];

  if (ids.length) {
    const queue = getAudienceQueue();
    for (const sourceId of ids) {
      const source = await prisma.source.findUnique({ where: { id: sourceId } });
      if (!source) continue;
      const job = await prisma.fetchJob.create({
        data: {
          sourceId: source.id,
          sourceUrl: buildAudienceEstimateUrl(source.id),
          sourceType: source.type
        }
      });
      await queue.add("fetch", { fetchJobId: job.id });
    }
    await queue.close();
  }

  return redirectTo("/admin/sources");
}
