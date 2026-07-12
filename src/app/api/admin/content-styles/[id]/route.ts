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
    const replacement = await prisma.contentStyle.findFirst({
      where: { id: { not: id } },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
    });
    await prisma.contentTopic.updateMany({
      where: { styleId: id },
      data: { styleId: replacement?.id || null }
    });
    await prisma.fetchJob.updateMany({
      where: { contentStyleId: id },
      data: { contentStyleId: replacement?.id || null }
    });
    await prisma.contentStyle.delete({ where: { id } }).catch(() => undefined);
    return redirectTo("/admin/settings?tab=prompts");
  }

  const isDefault = form.get("isDefault") === "true";
  if (isDefault) {
    await prisma.contentStyle.updateMany({
      where: { id: { not: id } },
      data: { isDefault: false }
    });
  }

  await prisma.contentStyle.update({
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

  return redirectTo("/admin/settings?tab=prompts");
}
