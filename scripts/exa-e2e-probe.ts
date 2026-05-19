/**
 * One-off probe: print the latest FetchJob for the Exa smoke topic and its
 * resulting Post (via RawItem). Read-only; safe to re-run.
 */
import { prisma } from "../src/lib/prisma";

async function main() {
  const topic = await prisma.contentTopic.findUnique({ where: { slug: "exa-smoke-test" } });
  if (!topic) {
    console.log("topic not found");
    return;
  }
  const jobs = await prisma.fetchJob.findMany({
    where: { contentTopicId: topic.id },
    orderBy: { createdAt: "desc" },
    take: 3,
    include: { rawItems: { include: { post: true } } }
  });
  for (const job of jobs) {
    console.log("=== FetchJob ===");
    console.log({
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      error: job.error
    });
    for (const ri of job.rawItems) {
      console.log("  -- RawItem --", { id: ri.id, title: ri.title });
      if (ri.post) {
        console.log("     Post:", { id: ri.post.id, slug: ri.post.slug, status: ri.post.status, title: ri.post.title });
      } else {
        console.log("     (no post yet)");
      }
    }
  }
}

main().finally(() => prisma.$disconnect());
