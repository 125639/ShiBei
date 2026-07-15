import { PrismaClient } from "@prisma/client";
import { assessEvidenceClaimConsistency } from "../src/lib/evidence-claim-consistency";
import { extractTrustedEvidenceManifest } from "../src/lib/post-repair";

const prisma = new PrismaClient();

async function main() {
  const posts = await prisma.post.findMany({
    where: {
      rawItem: { is: { markdown: { contains: "trusted-evidence-v1" } } }
    },
    orderBy: { createdAt: "desc" },
    take: 80,
    select: {
      id: true,
      title: true,
      status: true,
      content: true,
      createdAt: true,
      rawItem: { select: { markdown: true, artifactKind: true } }
    }
  });

  let checked = 0;
  let failed = 0;
  let failedPublished = 0;
  for (const post of posts) {
    const evidence = extractTrustedEvidenceManifest(post.rawItem?.markdown);
    if (!evidence.length) continue; // no manifest → gate is a no-op anyway
    checked++;
    const result = assessEvidenceClaimConsistency(post.content, evidence);
    if (!result.ok) {
      failed++;
      if (post.status === "PUBLISHED") failedPublished++;
      console.log("\n==============================================");
      console.log(`FAIL  ${post.status}  ${post.id}  ${post.createdAt.toISOString()}`);
      console.log(`title: ${post.title}`);
      console.log(`evidence items: ${evidence.length}`);
      console.log(result.reason);
    }
  }
  console.log(`\n\nSUMMARY: checked ${checked} articles with manifests; ${failed} REJECTED by assessEvidenceClaimConsistency (${failedPublished} of them PUBLISHED).`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
