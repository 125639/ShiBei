import { SourceType, SourceRegion } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { normalizePopularity } from "@/lib/form-number";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { getAudienceQueue } from "@/lib/queue";
import { buildAudienceEstimateUrl } from "@/lib/audience";

function parseRegion(value: string | undefined | null): SourceRegion {
  if (value === "DOMESTIC") return "DOMESTIC";
  if (value === "INTERNATIONAL") return "INTERNATIONAL";
  return "UNKNOWN";
}

function parseType(value: string | undefined | null): SourceType {
  if (value === "RSS" || value === "VIDEO" || value === "EXA") return value;
  return "WEB";
}

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();

  const moduleIds = form.getAll("moduleIds").map(String).filter(Boolean);

  const source = await prisma.source.create({
    data: {
      name: String(form.get("name") || "未命名来源"),
      url: String(form.get("url") || ""),
      type: parseType(form.get("type") as string | null),
      isDefault: form.get("isDefault") === "true",
      popularity: normalizePopularity(form.get("popularity")),
      region: parseRegion(form.get("region") as string | null),
      ...(moduleIds.length
        ? { modules: { connect: moduleIds.map((id) => ({ id })) } }
        : {})
    }
  });

  if (!form.get("popularity")) {
    const queue = getAudienceQueue();
    try {
      const job = await prisma.fetchJob.create({
        data: {
          sourceId: source.id,
          sourceUrl: buildAudienceEstimateUrl(source.id),
          sourceType: source.type === "EXA" ? "WEB" : source.type
        }
      });
      await queue.add("fetch", { fetchJobId: job.id });
    } finally {
      await queue.close().catch(() => undefined);
    }
  }

  return redirectTo("/admin/sources");
}
