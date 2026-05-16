import { requireAdmin } from "@/lib/auth";
import { isContentLanguageMode } from "@/lib/language";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { isDisplayMode } from "@/lib/topics";

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const autoCurationEnabled = form.get("autoCurationEnabled") === "true";
  const rawDisplayMode = String(form.get("contentDisplayMode") || "grid");
  const contentDisplayMode = isDisplayMode(rawDisplayMode) ? rawDisplayMode : "grid";
  const rawLanguageMode = String(form.get("contentLanguageMode") || "default-language");
  const contentLanguageMode = isContentLanguageMode(rawLanguageMode) ? rawLanguageMode : "default-language";

  const existing = await prisma.siteSettings.findUnique({ where: { id: "site" } });
  if (existing) {
    await prisma.siteSettings.update({
      where: { id: "site" },
      data: { autoCurationEnabled, contentDisplayMode, contentLanguageMode }
    });
  } else {
    await prisma.siteSettings.create({
      data: {
        id: "site",
        autoCurationEnabled,
        contentDisplayMode,
        contentLanguageMode
      }
    });
  }

  return redirectTo("/admin/auto-curation");
}
