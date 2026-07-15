import { prisma } from "../src/lib/prisma";
import { parseKeywordResearchUrl, type ResearchDepth } from "../src/lib/research";
import {
  buildTrustedResearchInventoryUpgrade,
  extractLegacyPostRepairEvidence,
  extractTrustedEvidenceManifest,
  matchingTrustedResearchDiscoveryUrls
} from "../src/lib/post-repair";
import { shutdownScrapeBrowser } from "../src/lib/scrape";
import { assessEvidenceSufficiency } from "../src/lib/source-quality";
import { revalidateArchivedEvidence, selectWritingEvidence } from "../src/worker/evidence";

/**
 * One-time compatibility upgrade for research artifacts created before the
 * machine-readable evidence manifest. Every candidate is fetched again and
 * passed through the current evidence selector; the readable Markdown list is
 * never promoted directly. Default scope is the small set of modern-format
 * rows plus every legacy article that is already published (so a later edit
 * remains publishable). Pass --all to include the much larger legacy draft
 * inventory as well; drafts are otherwise upgraded on demand by AI repair.
 */
async function main() {
  const includeLegacy = process.argv.includes("--all");
  const rows = await prisma.rawItem.findMany({
    where: { post: { isNot: null } },
    select: {
      id: true,
      title: true,
      url: true,
      markdown: true,
      fetchJob: { select: { sourceUrl: true } },
      post: { select: { id: true, status: true, title: true } }
    },
    orderBy: { createdAt: "asc" }
  });

  const candidates = rows.filter((row) => {
    if (/^https?:\/\//i.test(row.url) || extractTrustedEvidenceManifest(row.markdown).length) return false;
    if (/^##\s*可用于写作的正文资料\s*$/im.test(row.markdown)) return true;
    return (includeLegacy || row.post?.status === "PUBLISHED") && /^##\s*研究资料\s*$/im.test(row.markdown);
  });
  const report = {
    inspected: candidates.length,
    upgraded: 0,
    recoveredFromTrustedSibling: 0,
    skipped: 0,
    conflicts: 0,
    failures: [] as string[]
  };
  // The query is oldest-first for deterministic upgrade order. Discovery
  // fallback prefers the newest independently admitted sibling artifact.
  const artifactsNewestFirst = [...rows].reverse().map((row) => ({
    id: row.id,
    fetchSourceUrl: row.fetchJob?.sourceUrl,
    markdown: row.markdown
  }));

  for (const row of candidates) {
    if (row.url.startsWith("digest://")) {
      report.skipped += 1;
      report.failures.push(`${row.id}：历史日报/周报缺少可核验时间窗，必须重跑原定时报任务`);
      continue;
    }
    const archived = extractLegacyPostRepairEvidence(row.markdown);
    let research: ReturnType<typeof parseKeywordResearchUrl> = null;
    try {
      research = parseKeywordResearchUrl(row.fetchJob?.sourceUrl || "");
    } catch {
      research = null;
    }
    const keyword = research?.keyword || row.title.replace(/^关键词研究\s*[：:]\s*/i, "").trim();
    let transientFailures = 0;
    let revalidated = await revalidateArchivedEvidence(archived, 8, () => { transientFailures += 1; });
    let selected = selectWritingEvidence(revalidated, keyword);
    const depth = research?.depth || (row.url.startsWith("keyword://") ? "long" : null);
    let gate = assessEvidenceSufficiency(selected, evidencePolicy(depth, selected.length));
    let fallbackFailure = "";
    if (!gate.ok && research) {
      const fallbackUrls = matchingTrustedResearchDiscoveryUrls({
        targetRawItemId: row.id,
        targetFetchSourceUrl: row.fetchJob?.sourceUrl,
        artifactsNewestFirst,
        limit: 8
      });
      if (fallbackUrls.length) {
        let fallbackTransientFailures = 0;
        const fallbackCandidates = fallbackUrls.map((url) => ({
          // Discovery-only placeholders. revalidateArchivedEvidence deliberately
          // discards every field except URL and rebuilds metadata from the live page.
          title: url,
          url,
          sourceName: new URL(url).hostname,
          summary: url
        }));
        const fallbackRevalidated = await revalidateArchivedEvidence(
          fallbackCandidates,
          8,
          () => { fallbackTransientFailures += 1; }
        );
        const fallbackSelected = selectWritingEvidence(fallbackRevalidated, keyword);
        const fallbackGate = assessEvidenceSufficiency(
          fallbackSelected,
          evidencePolicy(depth, fallbackSelected.length)
        );
        transientFailures += fallbackTransientFailures;
        if (fallbackGate.ok) {
          revalidated = fallbackRevalidated;
          selected = fallbackSelected;
          gate = fallbackGate;
          report.recoveredFromTrustedSibling += 1;
        } else {
          fallbackFailure = `；同身份可信清单的 URL 实时复核仍未通过：${fallbackGate.reason}`;
        }
      }
    }
    if (!gate.ok) {
      report.skipped += 1;
      report.failures.push(`${row.id} (${row.post?.status || "UNKNOWN"})：${gate.reason}${fallbackFailure}${transientFailures ? `；${transientFailures} 个来源抓取失败` : ""}`);
      continue;
    }

    const upgraded = buildTrustedResearchInventoryUpgrade({
      markdown: row.markdown,
      trustedEvidence: selected,
      allEvidence: revalidated
    });
    if (upgraded === row.markdown || !extractTrustedEvidenceManifest(upgraded).length) {
      report.skipped += 1;
      report.failures.push(`${row.id}：无法生成可信清单`);
      continue;
    }
    const updated = await prisma.rawItem.updateMany({
      where: { id: row.id, markdown: row.markdown },
      data: { markdown: upgraded }
    });
    if (updated.count === 1) report.upgraded += 1;
    else report.conflicts += 1;
  }

  console.log(JSON.stringify(report, null, 2));
  if (report.failures.length) process.exitCode = 2;
}

function evidencePolicy(depth: ResearchDepth | null, itemCount: number) {
  if (depth === "deep") {
    return { minItems: 3, minTotalInformationChars: 2200, strongSingleItemChars: null, minFullTextItems: 3 };
  }
  if (depth === "standard") {
    return { minItems: 2, minTotalInformationChars: 700, strongSingleItemChars: 900, minFullTextItems: 1 };
  }
  if (depth === "long") {
    return { minItems: 2, minTotalInformationChars: 1200, strongSingleItemChars: null, minFullTextItems: 2 };
  }
  return {
    minItems: itemCount === 1 ? 1 : 2,
    minTotalInformationChars: itemCount === 1 ? 500 : 800,
    strongSingleItemChars: itemCount === 1 ? 500 : 900,
    minFullTextItems: 1
  };
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await shutdownScrapeBrowser();
    } finally {
      await prisma.$disconnect();
    }
  });
