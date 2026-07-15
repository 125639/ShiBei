import { requireAdmin } from "@/lib/auth";
import { DEFAULT_BLOG_STYLE, normalizeContentMode } from "@/lib/content-style";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await context.params;
  const form = await request.formData();
  const intent = String(form.get("_intent") || "update");

  if (intent === "delete") {
    await prisma.$transaction(async (tx) => {
      const replacement = await tx.contentStyle.findFirst({
        where: { id: { not: id } },
        orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
      });
      await tx.contentTopic.updateMany({
        where: { styleId: id },
        data: { styleId: replacement?.id || null }
      });
      await tx.fetchJob.updateMany({
        where: { contentStyleId: id },
        data: { contentStyleId: replacement?.id || null }
      });
      await tx.contentStyle.delete({ where: { id } });
      if (replacement && !replacement.isDefault) {
        await tx.contentStyle.update({ where: { id: replacement.id }, data: { isDefault: true } });
      }
    }).catch((error: unknown) => {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") return;
      throw error;
    });
    return redirectTo("/admin/settings?tab=prompts");
  }

  const isDefault = form.get("isDefault") === "true";
  await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.contentStyle.updateMany({
        where: { id: { not: id } },
        data: { isDefault: false }
      });
    }
    await tx.contentStyle.update({
      where: { id },
      data: {
        name: String(form.get("name") || DEFAULT_BLOG_STYLE.name),
        contentMode: normalizeContentMode(String(form.get("contentMode") || DEFAULT_BLOG_STYLE.contentMode)),
        tone: String(form.get("tone") || DEFAULT_BLOG_STYLE.tone),
        length: String(form.get("length") || DEFAULT_BLOG_STYLE.length),
        focus: String(form.get("focus") || DEFAULT_BLOG_STYLE.focus),
        outputStructure: String(form.get("outputStructure") || DEFAULT_BLOG_STYLE.outputStructure),
        customInstructions: String(form.get("customInstructions") || ""),
        isDefault
      }
    });
  });

  return redirectTo("/admin/settings?tab=prompts");
}
