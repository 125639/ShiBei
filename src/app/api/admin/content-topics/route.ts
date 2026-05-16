import { requireAdmin } from "@/lib/auth";
import { parseTopicForm } from "@/lib/content-topic-form";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { syncSchedule } from "@/lib/scheduler";

export async function POST(request: Request) {
  await requireAdmin();
  const parsed = parseTopicForm(await request.formData());
  if (!parsed || !parsed.name || !parsed.slug || !parsed.keywords) {
    return redirectTo("/admin/auto-curation");
  }

  const topic = await prisma.contentTopic.create({
    data: {
      name: parsed.name,
      slug: parsed.slug,
      scope: parsed.scope,
      keywords: parsed.keywords,
      compileKind: parsed.compileKind,
      depth: parsed.depth,
      articleCount: parsed.articleCount,
      styleId: parsed.styleId,
      isEnabled: parsed.isEnabled
    }
  });

  const schedule = await prisma.autoSchedule.create({
    data: {
      topicId: topic.id,
      cron: parsed.cron,
      isEnabled: parsed.isEnabled
    }
  });

  await syncSchedule(schedule.id);

  return redirectTo("/admin/auto-curation");
}
