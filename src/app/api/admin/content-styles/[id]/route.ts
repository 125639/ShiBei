import { requireAdmin } from "@/lib/auth";
import { normalizeContentMode } from "@/lib/content-style";
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
      name: String(form.get("name") || "内容风格"),
      contentMode: normalizeContentMode(String(form.get("contentMode") || "report")),
      tone: String(form.get("tone") || "客观"),
      length: String(form.get("length") || "中"),
      focus: String(form.get("focus") || "核心事实, 背景脉络, 多方观点"),
      outputStructure: String(form.get("outputStructure") || "标题 → 导语 → 正文分章节叙述 → 参考来源"),
      customInstructions: String(form.get("customInstructions") || ""),
      isDefault
    }
  });

  return redirectTo("/admin/settings?tab=prompts");
}
