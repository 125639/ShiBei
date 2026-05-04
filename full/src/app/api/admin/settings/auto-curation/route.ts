import { requireAdmin } from "@/lib/auth";
import { isNewsLanguageMode } from "@/lib/language";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { isDisplayMode } from "@/lib/topics";

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const autoCurationEnabled = form.get("autoCurationEnabled") === "true";
  const rawDisplayMode = String(form.get("newsDisplayMode") || "grid");
  const newsDisplayMode = isDisplayMode(rawDisplayMode) ? rawDisplayMode : "grid";
  const rawLanguageMode = String(form.get("newsLanguageMode") || "default-language");
  const newsLanguageMode = isNewsLanguageMode(rawLanguageMode) ? rawLanguageMode : "default-language";

  const existing = await prisma.siteSettings.findUnique({ where: { id: "site" } });
  if (existing) {
    await prisma.siteSettings.update({
      where: { id: "site" },
      data: { autoCurationEnabled, newsDisplayMode, newsLanguageMode }
    });
  } else {
    await prisma.siteSettings.create({
      data: {
        id: "site",
        autoCurationEnabled,
        newsDisplayMode,
        newsLanguageMode
      }
    });
  }

  return redirectTo("/admin/auto-curation");
}
