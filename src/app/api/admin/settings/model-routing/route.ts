import { revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

const MODEL_ROLE_FIELDS = [
  "contentModelConfigId",
  "assistantModelConfigId",
  "writingModelConfigId",
  "translationModelConfigId"
] as const;

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const assignments = Object.fromEntries(
    MODEL_ROLE_FIELDS.map((field) => [field, optionalId(form.get(field))])
  ) as Record<(typeof MODEL_ROLE_FIELDS)[number], string | null>;

  const selectedIds = Array.from(new Set(Object.values(assignments).filter((id): id is string => Boolean(id))));
  if (selectedIds.length) {
    const existing = await prisma.modelConfig.findMany({
      where: { id: { in: selectedIds }, isEnabled: true },
      select: { id: true }
    });
    if (existing.length !== selectedIds.length) {
      return redirectTo("/admin/settings?tab=models&modelError=invalid_assignment", request);
    }
  }

  await prisma.siteSettings.upsert({
    where: { id: "site" },
    update: assignments,
    create: { id: "site", ...assignments }
  });
  revalidateTag("site-settings", { expire: 0 });
  return redirectTo("/admin/settings?tab=models&saved=1", request);
}

function optionalId(value: FormDataEntryValue | null) {
  const id = String(value || "").trim();
  return id || null;
}
