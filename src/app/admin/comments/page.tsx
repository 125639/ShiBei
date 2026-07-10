import { AdminShell } from "@/components/AdminShell";
import { AdminCommentManager, type AdminCommentView } from "@/components/AdminCommentManager";
import { I18nText } from "@/components/I18nText";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminCommentsPage() {
  await requireAdmin();
  const [comments, settings] = await Promise.all([
    prisma.comment.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        member: { select: { displayName: true, username: true, email: true } },
        post: { select: { title: true, slug: true } }
      }
    }),
    prisma.siteSettings.findUnique({ where: { id: "site" }, select: { commentsEnabled: true } })
  ]);

  const initialComments: AdminCommentView[] = comments.map((comment) => ({
    id: comment.id,
    content: comment.content,
    createdAt: comment.createdAt.toISOString(),
    author:
      comment.member.displayName ||
      comment.member.username ||
      (comment.member.email ? comment.member.email.split("@")[0] : "会员"),
    postTitle: comment.post.title,
    postSlug: comment.post.slug
  }));

  return (
    <AdminShell>
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">Community</p>
          <h1><I18nText zh="评论管理" en="Comments" /></h1>
          <p className="muted">
            {settings?.commentsEnabled ? (
              <I18nText zh="评论功能已开启（注册会员可评论）。可在 系统设置 → 媒体 关闭。" en="Comments are enabled for registered members. Toggle in Settings → Media." />
            ) : (
              <I18nText zh="评论功能当前关闭。可在 系统设置 → 媒体 开启。" en="Comments are currently disabled. Enable in Settings → Media." />
            )}
          </p>
        </div>
      </div>
      <AdminCommentManager initialComments={initialComments} />
    </AdminShell>
  );
}
