/**
 * Verify the per-topic useExa gate: flip the test topic to useExa=false,
 * enqueue another run, then check that the resulting evidence contains
 * zero `[Exa]` entries. Restores useExa=true afterwards.
 */
import { prisma } from "../src/lib/prisma";
import { enqueueTopicRun } from "../src/lib/auto-curation";

async function main() {
  const topic = await prisma.contentTopic.findUnique({ where: { slug: "exa-smoke-test" } });
  if (!topic) throw new Error("test topic missing");

  await prisma.contentTopic.update({ where: { id: topic.id }, data: { useExa: false } });
  console.log("set useExa=false");

  const start = new Date();
  const r = await enqueueTopicRun(topic.id);
  console.log("enqueued:", r);

  let job = null;
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    job = await prisma.fetchJob.findFirst({
      where: { contentTopicId: topic.id, createdAt: { gte: start } },
      orderBy: { createdAt: "desc" },
      include: { rawItems: true }
    });
    if (job?.status === "COMPLETED" || job?.status === "FAILED") break;
    if (i % 5 === 0) console.log(`  ...${job?.status || "queued"}`);
  }
  if (!job) throw new Error("no job");

  const raw = job.rawItems[0];
  const exaHits = raw?.markdown.match(/\[Exa\]/g)?.length ?? 0;
  console.log(`\njob=${job.status} rawItem=${raw?.id}`);
  console.log(`[Exa] occurrences in evidence: ${exaHits}`);
  if (exaHits > 0) {
    console.log("FAIL — useExa=false but Exa still ran");
  } else {
    console.log("PASS — Exa was skipped as expected");
  }

  await prisma.contentTopic.update({ where: { id: topic.id }, data: { useExa: true } });
  console.log("restored useExa=true");
}

main().finally(() => prisma.$disconnect());
