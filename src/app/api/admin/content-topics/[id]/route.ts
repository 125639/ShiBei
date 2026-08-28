import { requireAdmin } from "@/lib/auth";
import { parseTopicForm } from "@/lib/content-topic-form";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { syncSchedule } from "@/lib/scheduler";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await context.params;
  const parsed = parseTopicForm(await request.formData());
  if (!parsed) return redirectTo("/admin/auto-curation");

  const modules = parsed.moduleIds.length
    ? await prisma.sourceModule.findMany({
        where: { id: { in: parsed.moduleIds } },
        select: { id: true }
      })
    : [];

  const schedule = await prisma.$transaction(async (tx) => {
    await tx.contentTopic.update({
      where: { id },
      data: {
        ...(parsed.name ? { name: parsed.name } : {}),
        ...(parsed.keywords ? { keywords: parsed.keywords } : {}),
        scope: parsed.scope,
        compileKind: parsed.compileKind,
        depth: parsed.depth,
        articleCount: parsed.articleCount,
        styleId: parsed.styleId,
        isEnabled: parsed.isEnabled,
        useExa: parsed.useExa,
        modules: { set: modules.map(({ id: moduleId }) => ({ id: moduleId })) }
      }
    });
    return tx.autoSchedule.upsert({
      where: { topicId: id },
      update: { cron: parsed.cron, isEnabled: parsed.isEnabled },
      create: { topicId: id, cron: parsed.cron, isEnabled: parsed.isEnabled }
    });
  });

  await syncSchedule(schedule.id);

  return redirectTo("/admin/auto-curation");
}
