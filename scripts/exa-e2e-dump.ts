/**
 * Dump the most recent Exa-smoke Post content to stdout, with evidence stats.
 */
import { prisma } from "../src/lib/prisma";

async function main() {
  const topic = await prisma.contentTopic.findUnique({ where: { slug: "exa-smoke-test" } });
  if (!topic) return console.log("topic not found");
  const post = await prisma.post.findFirst({
    where: { topics: { some: { id: topic.id } } },
    orderBy: { createdAt: "desc" },
    include: { rawItem: true, videos: true }
  });
  if (!post) return console.log("no post yet");

  console.log("=========================================");
  console.log("TITLE:", post.title);
  console.log("SUMMARY:", post.summary);
  console.log("STATUS:", post.status);
  console.log("SOURCE URL:", post.sourceUrl);
  console.log("CHARS:", post.content.length);
  console.log("=========================================");
  console.log(post.content);
  console.log("=========================================");
  console.log("VIDEOS attached:", post.videos.length);
  if (post.rawItem) {
    console.log("\n=== RawItem markdown (evidence used) ===");
    console.log(post.rawItem.markdown);
  }
}
main().finally(() => prisma.$disconnect());
