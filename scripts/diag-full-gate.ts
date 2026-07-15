import { PrismaClient } from "@prisma/client";
import { assertPublishableGeneratedArticle } from "../src/lib/source-quality";
import { extractTrustedEvidenceManifest } from "../src/lib/post-repair";

const prisma = new PrismaClient();

// Mirror the worker's gate options for keyword research (the main path).
function gateOptions(evidenceUrls: string[], style: { contentMode: string; length: string }) {
  const mode = style.contentMode;
  const requireSectionHeadings = style.length !== "短" && mode !== "essay" && mode !== "opinion";
  const minimumBodyInformationChars = style.length === "短" || mode === "opinion" || mode === "essay" ? 180 : 350;
  return {
    allowedSourceUrls: evidenceUrls,
    requireInlineCitation: true,
    requireSectionHeadings,
    minimumDistinctInlineSources: Math.min(2, new Set(evidenceUrls).size),
    minimumBodyInformationChars
  };
}

async function main() {
  const posts = await prisma.post.findMany({
    where: { rawItem: { is: { markdown: { contains: "trusted-evidence-v1" } } } },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true, title: true, status: true, content: true, createdAt: true,
      rawItem: { select: { markdown: true } }
    }
  });

  // Default style assumption: report/长 (the site default) — matches how these were generated.
  const style = { contentMode: "report", length: "长" };

  let checked = 0, failed = 0, failedPub = 0;
  const reasonBuckets = new Map<string, number>();
  for (const post of posts) {
    const evidence = extractTrustedEvidenceManifest(post.rawItem?.markdown);
    if (!evidence.length) continue;
    checked++;
    try {
      assertPublishableGeneratedArticle(post.content, gateOptions(evidence.map((e) => e.url), style));
    } catch (error) {
      failed++;
      if (post.status === "PUBLISHED") failedPub++;
      const reason = error instanceof Error ? error.message : String(error);
      const bucket = reason.slice(0, 60);
      reasonBuckets.set(bucket, (reasonBuckets.get(bucket) || 0) + 1);
      console.log(`FAIL ${post.createdAt.toISOString().slice(0, 10)} ${post.status} ${post.id} ${post.title.slice(0, 30)} :: ${reason.slice(0, 150).replace(/\n/g, " ")}`);
    }
  }
  console.log(`\n\nFULL-GATE SUMMARY: checked ${checked}; failed ${failed} (${failedPub} published)`);
  for (const [bucket, count] of reasonBuckets) console.log(`  [${count}x] ${bucket}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
