import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePublicContent } from "@/lib/revalidate-public";
import { redirectTo } from "@/lib/redirect";

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const ids = [...new Set(form.getAll("postId").map(String).filter(Boolean))];
  const action = String(form.get("action") || "delete");

  if (ids.length) {
    const affected = await prisma.post.findMany({
      where: { id: { in: ids } },
      select: { slug: true }
    });
    if (action === "publish") {
      await prisma.post.updateMany({
        where: { id: { in: ids }, publishedAt: null },
        data: { status: "PUBLISHED", publishedAt: new Date() }
      });
      await prisma.post.updateMany({
        where: { id: { in: ids }, publishedAt: { not: null } },
        data: { status: "PUBLISHED" }
      });
    } else if (action === "draft") {
      await prisma.post.updateMany({ where: { id: { in: ids } }, data: { status: "DRAFT", publishedAt: null } });
    } else if (action === "archive") {
      await prisma.post.updateMany({ where: { id: { in: ids } }, data: { status: "ARCHIVED" } });
    } else {
      await prisma.post.deleteMany({
        where: { id: { in: ids } }
      });
    }
    revalidatePublicContent(affected.map((post) => `/posts/${post.slug}`));
  }

  return redirectTo("/admin/posts");
}
