import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePublicContent } from "@/lib/revalidate-public";
import { redirectTo } from "@/lib/redirect";

const VALID_ACTIONS = new Set(["delete", "publish", "draft", "archive"]);

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const ids = [...new Set(form.getAll("postId").map(String).filter(Boolean))];
  const action = String(form.get("action") || "delete");

  // 白名单校验：意料之外的 action 不能落到 else 分支里被当成删除执行。
  if (!VALID_ACTIONS.has(action)) {
    return redirectTo("/admin/posts");
  }

  if (ids.length) {
    // 事务包裹：查 slug 与批量更新要么全部生效要么全部回滚，
    // 避免中途失败导致部分文章已改状态但缓存未刷新。
    const affected = await prisma.$transaction(async (tx) => {
      const posts = await tx.post.findMany({
        where: { id: { in: ids } },
        select: { slug: true }
      });
      if (action === "publish") {
        await tx.post.updateMany({
          where: { id: { in: ids }, publishedAt: null },
          data: { status: "PUBLISHED", publishedAt: new Date() }
        });
        await tx.post.updateMany({
          where: { id: { in: ids }, publishedAt: { not: null } },
          data: { status: "PUBLISHED" }
        });
      } else if (action === "draft") {
        await tx.post.updateMany({ where: { id: { in: ids } }, data: { status: "DRAFT", publishedAt: null } });
      } else if (action === "archive") {
        await tx.post.updateMany({ where: { id: { in: ids } }, data: { status: "ARCHIVED" } });
      } else {
        await tx.post.deleteMany({
          where: { id: { in: ids } }
        });
      }
      return posts;
    });
    revalidatePublicContent(affected.map((post) => `/posts/${post.slug}`));
  }

  return redirectTo("/admin/posts");
}
