import { AdminShell } from "@/components/AdminShell";
import { AdminAiManager } from "@/components/AdminAiManager";
import { I18nText } from "@/components/I18nText";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function AdminAiPage() {
  await requireAdmin();
  const styles = await prisma.contentStyle.findMany({
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    select: { id: true, name: true, isDefault: true },
    take: 100
  });

  return (
    <AdminShell>
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">AI Admin</p>
          <h1><I18nText zh="AI 管理员" en="AI Admin" /></h1>
        </div>
      </div>
      <AdminAiManager styles={styles} />
    </AdminShell>
  );
}
