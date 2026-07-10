import { AdminShell } from "@/components/AdminShell";
import { AdminInviteManager, type InviteCodeView } from "@/components/AdminInviteManager";
import { I18nText } from "@/components/I18nText";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminInvitesPage() {
  await requireAdmin();
  const codes = await prisma.inviteCode.findMany({
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { member: { select: { username: true, displayName: true } } }
  });

  const initialCodes: InviteCodeView[] = codes.map((row) => ({
    id: row.id,
    code: row.code,
    status: row.status,
    note: row.note,
    usedBy: row.member ? row.member.displayName || row.member.username : null,
    usedAt: row.usedAt ? row.usedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString()
  }));

  return (
    <AdminShell>
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">Members</p>
          <h1><I18nText zh="邀请码" en="Invite Codes" /></h1>
        </div>
      </div>
      <AdminInviteManager initialCodes={initialCodes} />
    </AdminShell>
  );
}
