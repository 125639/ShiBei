import { requireAdmin } from "@/lib/auth";
import { SourceRegion, SourceType } from "@prisma/client";
import { normalizePopularity } from "@/lib/form-number";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const sourceId = String(form.get("sourceId") || "");
  const fullEdit = form.get("fullEdit") === "true";

  if (sourceId) {
    const popularity = normalizePopularity(form.get("popularity"));
    if (!fullEdit) {
      await prisma.source.update({
        where: { id: sourceId },
        data: { popularity, popularityUpdatedAt: new Date() }
      });
      return redirectTo("/admin/sources");
    }

    const name = String(form.get("name") || "").trim();
    const url = String(form.get("url") || "").trim();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return redirectTo("/admin/sources?error=invalid-url");
    }
    if (!name || !["http:", "https:"].includes(parsedUrl.protocol)) {
      return redirectTo("/admin/sources?error=invalid-source");
    }

    const typeValue = String(form.get("type") || "WEB");
    const type: SourceType = ["WEB", "RSS", "VIDEO", "EXA"].includes(typeValue)
      ? typeValue as SourceType
      : "WEB";
    const regionValue = String(form.get("region") || "UNKNOWN");
    const region: SourceRegion = ["DOMESTIC", "INTERNATIONAL"].includes(regionValue)
      ? regionValue as SourceRegion
      : "UNKNOWN";
    const requestedModuleIds = [...new Set(form.getAll("moduleIds").map(String).filter(Boolean))];
    const existingModules = requestedModuleIds.length
      ? await prisma.sourceModule.findMany({
          where: { id: { in: requestedModuleIds } },
          select: { id: true }
        })
      : [];

    await prisma.source.update({
      where: { id: sourceId },
      data: {
        name,
        url: parsedUrl.toString(),
        type,
        region,
        isDefault: form.get("isDefault") === "true",
        popularity,
        popularityUpdatedAt: new Date(),
        modules: { set: existingModules.map(({ id }) => ({ id })) }
      }
    });
  }

  return redirectTo("/admin/sources");
}
