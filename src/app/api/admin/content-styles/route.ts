import { requireAdmin } from "@/lib/auth";
import { DEFAULT_BLOG_STYLE, normalizeContentMode } from "@/lib/content-style";
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
      name: String(form.get("name") || DEFAULT_BLOG_STYLE.name),
      contentMode: normalizeContentMode(String(form.get("contentMode") || DEFAULT_BLOG_STYLE.contentMode)),
      tone: String(form.get("tone") || DEFAULT_BLOG_STYLE.tone),
      length: String(form.get("length") || DEFAULT_BLOG_STYLE.length),
      focus: String(form.get("focus") || DEFAULT_BLOG_STYLE.focus),
      outputStructure: String(form.get("outputStructure") || DEFAULT_BLOG_STYLE.outputStructure),
      customInstructions: String(form.get("customInstructions") || DEFAULT_BLOG_STYLE.customInstructions),
      isDefault
    }
  });

  return redirectTo("/admin/settings?tab=prompts");
}
