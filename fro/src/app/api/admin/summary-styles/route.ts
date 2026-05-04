import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const isDefault = form.get("isDefault") === "true";

  if (isDefault) {
    await prisma.summaryStyle.updateMany({ data: { isDefault: false } });
  }

  await prisma.summaryStyle.create({
    data: {
      name: String(form.get("name") || "默认风格"),
      tone: String(form.get("tone") || "客观新闻"),
      length: String(form.get("length") || "中"),
      focus: String(form.get("focus") || "事实, 影响"),
      outputStructure: String(form.get("outputStructure") || "标题, 摘要, 关键点, 来源"),
      promptTemplate: String(form.get("promptTemplate") || "请整理为中文新闻总结。"),
      isDefault
    }
  });

  return redirectTo("/admin/settings");
}
