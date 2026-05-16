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

  await prisma.contentTopic.update({
    where: { id },
    data: {
      ...(parsed.name ? { name: parsed.name } : {}),
      ...(parsed.keywords ? { keywords: parsed.keywords } : {}),
      scope: parsed.scope,
      compileKind: parsed.compileKind,
      depth: parsed.depth,
      articleCount: parsed.articleCount,
      styleId: parsed.styleId,
      isEnabled: parsed.isEnabled
    }
  });

  const schedule = await prisma.autoSchedule.upsert({
    where: { topicId: id },
    update: { cron: parsed.cron, isEnabled: parsed.isEnabled },
    create: { topicId: id, cron: parsed.cron, isEnabled: parsed.isEnabled }
  });

  await syncSchedule(schedule.id);

  return redirectTo("/admin/auto-curation");
}
