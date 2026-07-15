import { AdminShell } from "@/components/AdminShell";
import { AdminInviteManager, type InviteCodeView } from "@/components/AdminInviteManager";
import { I18nText } from "@/components/I18nText";
import { Pagination } from "@/components/Pagination";
import { requireAdmin } from "@/lib/auth";
import { inviteCodeForAdmin } from "@/lib/invite-codes";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function AdminInvitesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const rawPage = typeof params.page === "string" ? Number(params.page) : 1;
  const requestedPage = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const total = await prisma.inviteCode.count();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const codes = await prisma.inviteCode.findMany({
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: { member: { select: { username: true, displayName: true } } }
  });

  const initialCodes: InviteCodeView[] = codes.map((row) => ({
    id: row.id,
    code: inviteCodeForAdmin(row.status, row.code),
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
      <AdminInviteManager initialCodes={initialCodes} page={page} />
      <Pagination basePath="/admin/invites" page={page} totalPages={totalPages} />
    </AdminShell>
  );
}
