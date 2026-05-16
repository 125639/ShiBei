import { requireAdmin } from "@/lib/auth";
import { normalizeContentMode } from "@/lib/content-style";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const isDefault = form.get("isDefault") === "true";

  if (isDefault) {
    await prisma.contentStyle.updateMany({ data: { isDefault: false } });
  }

  await prisma.contentStyle.create({
    data: {
      name: String(form.get("name") || "默认内容风格"),
      contentMode: normalizeContentMode(String(form.get("contentMode") || "report")),
      tone: String(form.get("tone") || "客观"),
      length: String(form.get("length") || "中"),
      focus: String(form.get("focus") || "核心事实, 行业影响, 背景脉络, 多方观点"),
      outputStructure: String(form.get("outputStructure") || "标题 → 导语 → 正文分章节叙述 → 背景分析 → 参考来源"),
      customInstructions: String(form.get("customInstructions") || "写一篇有深度的中文博客文章，要求正式标题、导语段落、分章节连贯叙述，禁止写成摘要或要点列表。"),
      isDefault
    }
  });

  return redirectTo("/admin/settings?tab=prompts");
}
