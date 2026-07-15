import { AdminCommunityManager, type AdminCommunityAuditView, type AdminCommunityWorkView } from "@/components/AdminCommunityManager";
import { AdminShell } from "@/components/AdminShell";
import { I18nText } from "@/components/I18nText";
import { requireAdmin } from "@/lib/auth";
import { SHARED_COMMUNITY_WORK_WHERE } from "@/lib/community-moderation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminCommunityPage() {
  await requireAdmin();

  // 后台首屏也只读取公开作品；私有草稿只能由其会员/匿名所有者访问。
  const [works, audits] = await Promise.all([
    prisma.creativeWork.findMany({
      where: SHARED_COMMUNITY_WORK_WHERE,
      orderBy: { publishedAt: "desc" },
      take: 200,
      select: {
        id: true,
        slug: true,
        title: true,
        summary: true,
        mode: true,
        score: true,
        publishedAt: true,
        ownerId: true,
        owner: { select: { displayName: true, username: true } },
        genre: { select: { name: true } }
      }
    }),
    prisma.communityModerationLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { admin: { select: { username: true } } }
    })
  ]);

  const initialWorks: AdminCommunityWorkView[] = works.map((work) => ({
    id: work.id,
    slug: work.slug,
    title: work.title,
    summary: work.summary,
    mode: work.mode,
    score: work.score,
    publishedAt: work.publishedAt?.toISOString() ?? null,
    isAnonymous: work.ownerId === null,
    author: work.owner ? work.owner.displayName || work.owner.username || "注册创作者" : "匿名创作者",
    genreName: work.genre.name
  }));
  const initialAudits: AdminCommunityAuditView[] = audits.map((audit) => ({
    id: audit.id,
    action: audit.action,
    reason: audit.reason,
    targetWorkId: audit.targetWorkId,
    titleSnapshot: audit.titleSnapshot,
    summarySnapshot: audit.summarySnapshot,
    slugSnapshot: audit.slugSnapshot,
    wasAnonymous: audit.wasAnonymous,
    adminUsername: audit.admin.username,
    createdAt: audit.createdAt.toISOString()
  }));

  return (
    <AdminShell>
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">Community Safety</p>
          <h1><I18nText zh="社区作品 / 内容治理" en="Community Content Moderation" /></h1>
          <p className="muted">
            <I18nText
              zh="这里只列出当前已公开作品。下架或删除必须填写原因，并永久写入管理员审计记录；会员和匿名用户的私有草稿不会显示。"
              en="Only currently public works appear here. Every takedown or deletion requires a reason and creates a permanent administrator audit record; private member and anonymous drafts are never listed."
            />
          </p>
        </div>
      </div>
      <AdminCommunityManager initialWorks={initialWorks} initialAudits={initialAudits} />
    </AdminShell>
  );
}
