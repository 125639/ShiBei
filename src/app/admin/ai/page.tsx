import { AdminShell } from "@/components/AdminShell";
import { AdminAiManager, type AdminAiBatchView } from "@/components/AdminAiManager";
import { I18nText } from "@/components/I18nText";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
import { parseKeywordResearchUrl } from "@/lib/research";
import { decodePostRepairResult, parsePostRepairUrl } from "@/lib/post-repair";

export default async function AdminAiPage() {
  await requireAdmin();
  const [styles, batches] = await Promise.all([
    prisma.contentStyle.findMany({
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      select: { id: true, name: true, isDefault: true },
      take: 100
    }),
    prisma.adminAiBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        jobs: {
          orderBy: { createdAt: "asc" },
          select: { id: true, status: true, sourceUrl: true, error: true, updatedAt: true }
        }
      }
    })
  ]);

  const initialBatches: AdminAiBatchView[] = batches.map((batch) => {
    let recurring: AdminAiBatchView["recurring"] = [];
    try {
      const snapshot = JSON.parse(batch.plan) as { createdTopics?: AdminAiBatchView["recurring"] };
      recurring = Array.isArray(snapshot.createdTopics) ? snapshot.createdTopics : [];
    } catch {
      // 快照解析失败只影响周期动作展示
    }
    return {
      id: batch.id,
      request: batch.request.slice(0, 300),
      summary: batch.summary,
      createdAt: batch.createdAt.toISOString(),
      recurring,
      jobs: batch.jobs.map((job) => {
        const repair = parsePostRepairUrl(job.sourceUrl);
        const repairResult = decodePostRepairResult(job.error);
        return {
          id: job.id,
          status: job.status,
          keyword: parseKeywordResearchUrl(job.sourceUrl)?.keyword || (repair ? `文章返修：${repairResult?.title || repair.postId}` : job.sourceUrl.slice(0, 80)),
          error: repairResult
            ? [repairResult.message, repairResult.reason].filter(Boolean).join("；").slice(0, 200)
            : job.error ? job.error.slice(0, 200) : null,
          updatedAt: job.updatedAt.toISOString()
        };
      })
    };
  });

  return (
    <AdminShell>
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">AI Admin</p>
          <h1><I18nText zh="AI 管理员" en="AI Admin" /></h1>
        </div>
      </div>
      <AdminAiManager styles={styles} initialBatches={initialBatches} />
    </AdminShell>
  );
}
