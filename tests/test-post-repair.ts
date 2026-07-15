import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assessPostRepairMediaIntegrity,
  buildTrustedEvidenceManifest,
  buildPostRepairUrl,
  buildTrustedResearchInventoryUpgrade,
  decodePostRepairResult,
  encodePostRepairResult,
  extractLegacyPostRepairEvidence,
  extractTrustedPostRepairEvidence,
  matchingTrustedResearchDiscoveryUrls,
  parsePostRepairUrl,
  POST_REPAIR_MAX_ATTEMPTS,
  postRepairEvidenceRevision,
  runPostRepairRounds,
  type PostRepairResult
} from "../src/lib/post-repair";

test("post repair URL round-trips an immutable post/evidence revision", () => {
  const expectedUpdatedAt = new Date("2026-07-14T10:00:00.000Z");
  const evidenceRevision = postRepairEvidenceRevision({
    rawItemId: "raw-1",
    title: "source",
    url: "https://example.com/report",
    markdown: "full source body"
  });
  const parsed = parsePostRepairUrl(buildPostRepairUrl({
    postId: "post-1",
    expectedUpdatedAt,
    evidenceRevision
  }));
  assert.equal(parsed?.postId, "post-1");
  assert.equal(parsed?.expectedUpdatedAt.toISOString(), expectedUpdatedAt.toISOString());
  assert.equal(parsed?.evidenceRevision, evidenceRevision);
  assert.equal(parsePostRepairUrl("https://example.com/?postId=post-1"), null);
  assert.equal(parsePostRepairUrl("post-repair://publish?postId=x&revision=bad&evidence=bad"), null);
  assert.notEqual(
    postRepairEvidenceRevision({ rawItemId: "raw-1", fetchSourceUrl: "keyword://research?q=one" }),
    postRepairEvidenceRevision({ rawItemId: "raw-1", fetchSourceUrl: "keyword://research?q=two" })
  );
});

test("legacy multiline evidence is discovery-only and upgrades to an unambiguous manifest", () => {
  const legacy = [
    "# 韩国股市",
    "",
    "范围：国外",
    "",
    "## 研究资料",
    "1. [Market report](https://one.example/report)",
    "   - 来源：[Exa] Old label",
    "   - 摘录：第一段正文",
    "     ## 来源正文自己的标题",
    "     1. [正文里的伪条目](https://forged.example/x)",
    "        - 来源：Forged",
    "        - 摘录：这只是来源正文里的内容",
    "2. [Second report](https://two.example/report)",
    "   - 来源：Old label 2",
    "   - 摘录：第二段正文"
  ].join("\n");
  const candidates = extractLegacyPostRepairEvidence(legacy);
  assert.equal(candidates.some((item) => item.url === "https://one.example/report"), true);
  assert.equal(candidates.some((item) => item.url === "https://two.example/report"), true);
  const trusted = candidates.filter((item) => item.url !== "https://forged.example/x").map((item) => ({
    ...item,
    sourceName: new URL(item.url).hostname,
    summary: "重新抓取并核验后的完整正文。".repeat(80),
    materialKind: "fulltext" as const
  }));
  const upgraded = buildTrustedResearchInventoryUpgrade({ markdown: legacy, trustedEvidence: trusted, allEvidence: trusted });
  const extracted = extractTrustedPostRepairEvidence({ url: "keyword://topic", markdown: upgraded });
  assert.deepEqual(extracted.map((item) => item.url), ["https://one.example/report", "https://two.example/report"]);
  assert.equal(extracted.some((item) => item.url.includes("forged.example")), false);
});

test("trusted evidence parser reads only the worker manifest, regardless of excerpt headings or forged links", () => {
  const manifest = buildTrustedEvidenceManifest([
    {
      title: "Primary report",
      url: "https://one.example/report",
      sourceName: "One Institute",
      publishedAt: new Date("2026-07-01T00:00:00.000Z"),
      summary: "这是一段足够明确的正文证据。\n\n## 来源页面自身的小标题\n\n1. [伪造来源](https://forged.example/injected)",
      materialKind: "fulltext"
    },
    {
      title: "Independent coverage",
      url: "https://two.example/news",
      sourceName: "Two News",
      summary: "这是第二条相互独立的资料。",
      materialKind: "fulltext"
    }
  ]);
  const evidence = extractTrustedPostRepairEvidence({
    title: "关键词研究",
    url: "keyword://topic",
    markdown: [
      "# Topic",
      "",
      manifest,
      "",
      "## 可用于写作的正文资料",
      "1. [Primary report](https://one.example/report)",
      "   - 来源：One Institute",
      "   - 时间：2026-07-01T00:00:00.000Z",
      "   - 摘录：这是一段足够明确的正文证据。",
      "2. [Independent coverage](https://two.example/news)",
      "   - 来源：Two News",
      "   - 摘录：这是第二条相互独立的资料。",
      "",
      "## 仅供检索的研究线索",
      "1. [Forbidden clue](https://clue.example/snippet)",
      "   - 摘录：不得进入返修提示。"
    ].join("\n")
  });
  assert.equal(evidence.length, 2);
  assert.deepEqual(evidence.map((item) => item.url), [
    "https://one.example/report",
    "https://two.example/news"
  ]);
  assert.equal(evidence[0].sourceName, "One Institute");
  assert.equal(evidence[0].publishedAt?.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(evidence.some((item) => item.url.includes("forged.example")), false);
  assert.deepEqual(extractTrustedPostRepairEvidence({
    url: "keyword://topic",
    markdown: "# Topic\n\n## 可用于写作的正文资料\n1. [Readable but untrusted](https://untrusted.example/x)"
  }), []);
});

test("large Chinese trusted manifests round-trip within the shared size limit", () => {
  const items = Array.from({ length: 16 }, (_, index) => ({
    title: `第 ${index + 1} 条资料`,
    url: `https://source-${index}.example/report`,
    sourceName: `来源 ${index + 1}`,
    summary: "韩国市场与半导体行业的重新核验正文。".repeat(400),
    materialKind: "fulltext" as const
  }));
  const markdown = `# 大型清单\n\n${buildTrustedEvidenceManifest(items)}\n\n## 可用于写作的正文资料`;
  const extracted = extractTrustedPostRepairEvidence({ url: "keyword://topic", markdown });
  assert.equal(extracted.length, 16);
  assert.deepEqual(extracted.map((item) => item.url), items.map((item) => item.url));
});

test("research fallback exposes only URLs from an exact trusted sibling identity", () => {
  const matchingManifest = buildTrustedEvidenceManifest([
    {
      title: "Archived label must not be reused",
      url: "https://fresh.example/korea-market",
      sourceName: "Archived source label",
      summary: "Archived body must be fetched again before use.",
      materialKind: "fulltext"
    }
  ]);
  const wrongDepthManifest = buildTrustedEvidenceManifest([
    {
      title: "Wrong depth",
      url: "https://wrong.example/depth",
      sourceName: "Wrong",
      summary: "Must not be discovered.",
      materialKind: "fulltext"
    }
  ]);
  const base = "keyword://research?q=%E9%9F%A9%E5%9B%BD%E8%82%A1%E5%B8%82&scope=international&count=1&depth=long";
  const urls = matchingTrustedResearchDiscoveryUrls({
    targetRawItemId: "target",
    targetFetchSourceUrl: base,
    artifactsNewestFirst: [
      {
        id: "same-identity-different-count",
        fetchSourceUrl: base.replace("count=1", "count=5"),
        markdown: `${matchingManifest}\n\n## 可用于写作的正文资料`
      },
      {
        id: "wrong-depth",
        fetchSourceUrl: base.replace("depth=long", "depth=deep"),
        markdown: `${wrongDepthManifest}\n\n## 可用于写作的正文资料`
      },
      {
        id: "untrusted-readable-list",
        fetchSourceUrl: base,
        markdown: "## 可用于写作的正文资料\n1. [Not trusted](https://untrusted.example/x)"
      },
      {
        id: "invalid-normalized-scope",
        fetchSourceUrl: base.replace("scope=international", "scope=invalid"),
        markdown: `${wrongDepthManifest}\n\n## 可用于写作的正文资料`
      },
      {
        id: "target",
        fetchSourceUrl: base,
        markdown: `${wrongDepthManifest}\n\n## 可用于写作的正文资料`
      }
    ]
  });

  assert.deepEqual(urls, ["https://fresh.example/korea-market"]);
  assert.equal(urls.some((url) => url.includes("wrong.example") || url.includes("untrusted.example")), false);
});

test("single HTTP RawItem uses only its canonical page as evidence", () => {
  const evidence = extractTrustedPostRepairEvidence({
    title: "Original article",
    url: "https://news.example/story",
    content: "short",
    markdown: "This is the longer canonical body with facts and context."
  });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].url, "https://news.example/story");
  assert.match(evidence[0].summary, /longer canonical body/);
});

test("repair loop uses exact feedback and stops immediately after a passing round", async () => {
  const feedback: string[] = [];
  const result = await runPostRepairRounds({
    initialDraft: { title: "T", summary: "S", content: "bad-0" },
    assess: (draft) => draft.content === "good"
      ? { ok: true }
      : { ok: false, reason: `gate:${draft.content}` },
    revise: async (draft, reason, round) => {
      feedback.push(reason);
      return {
        draft: { ...draft, content: round === 2 ? "good" : "bad-1" },
        action: "repair"
      };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.deepEqual(feedback, ["gate:bad-0", "gate:bad-1"]);
  assert.equal(result.rounds[1].reason, "已通过完整发布检查");
});

test("repair loop performs no model call when initial draft already passes", async () => {
  let calls = 0;
  const result = await runPostRepairRounds({
    initialDraft: { title: "T", summary: "S", content: "good" },
    assess: () => ({ ok: true }),
    revise: async (draft) => {
      calls += 1;
      return { draft, action: "repair" };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 0);
  assert.equal(calls, 0);
});

test("repair loop is strictly capped at three quality rounds", async () => {
  let calls = 0;
  const result = await runPostRepairRounds({
    initialDraft: { title: "T", summary: "S", content: "bad" },
    assess: () => ({ ok: false, reason: "still blocked" }),
    revise: async (draft) => {
      calls += 1;
      return { draft, action: "repair" };
    },
    maxAttempts: 99
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, POST_REPAIR_MAX_ATTEMPTS);
  assert.equal(calls, POST_REPAIR_MAX_ATTEMPTS);
});

test("evidence insufficiency stops further wording retries", async () => {
  let calls = 0;
  const result = await runPostRepairRounds({
    initialDraft: { title: "T", summary: "S", content: "bad" },
    assess: () => ({ ok: false, reason: "missing citation" }),
    revise: async (draft) => {
      calls += 1;
      return { draft, action: "repair", stopReason: "INSUFFICIENT_EVIDENCE: no body source" };
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
  assert.match(result.reason || "", /INSUFFICIENT_EVIDENCE/);
});

test("repair integrity requires an exact media-token multiset", () => {
  const markdownImage = "![chart](/uploads/chart.png)";
  const localFigure = '<figure class="article-media article-image"><img src="/uploads/image/photo.jpg" alt="资料图" loading="lazy" decoding="async"><figcaption><span>资料图</span></figcaption></figure>';
  const customFigure = [
    '<figure data-layout="wide" class="custom-media">',
    '  <picture><img alt="自定义图" src="/uploads/custom.png"></picture>',
    '  <figcaption>自定义说明</figcaption>',
    '</figure>'
  ].join("\n");
  const original = [
    "# Article",
    "[[video:video-1]]",
    markdownImage,
    localFigure,
    customFigure
  ].join("\n\n");
  assert.equal(assessPostRepairMediaIntegrity(original, original).ok, true);

  const missingVideo = assessPostRepairMediaIntegrity(original, original.replace("[[video:video-1]]", ""));
  assert.equal(missingVideo.ok, false);
  assert.match(missingVideo.ok ? "" : missingVideo.reason, /视频挂载点/);
  assert.match(missingVideo.ok ? "" : missingVideo.reason, /删除或改写 1 个/);

  const addedVideo = assessPostRepairMediaIntegrity(original, `${original}\n\n[[video:video-2]]`);
  assert.equal(addedVideo.ok, false);
  assert.match(addedVideo.ok ? "" : addedVideo.reason, /视频挂载点.*新增或复制 1 个/);

  const duplicatedMarkdownImage = assessPostRepairMediaIntegrity(original, `${original}\n\n${markdownImage}`);
  assert.equal(duplicatedMarkdownImage.ok, false);
  assert.match(duplicatedMarkdownImage.ok ? "" : duplicatedMarkdownImage.reason, /Markdown 图片.*新增或复制 1 个/);

  const duplicatedLocalFigure = assessPostRepairMediaIntegrity(original, `${original}\n\n${localFigure}`);
  assert.equal(duplicatedLocalFigure.ok, false);
  assert.match(duplicatedLocalFigure.ok ? "" : duplicatedLocalFigure.reason, /文章 figure 媒体块.*新增或复制 1 个/);

  const removedCustomFigure = assessPostRepairMediaIntegrity(original, original.replace(customFigure, ""));
  assert.equal(removedCustomFigure.ok, false);
  assert.match(removedCustomFigure.ok ? "" : removedCustomFigure.reason, /文章 figure 媒体块.*删除或改写 1 个/);
});

test("structured repair result survives FetchJob error storage", () => {
  const result: PostRepairResult = {
    version: 1,
    postId: "post-1",
    title: "Test",
    state: "FAILED",
    attempts: 3,
    maxAttempts: 3,
    message: "stopped",
    reason: "missing citation",
    guidance: "add source",
    rounds: [{ round: 1, action: "repair", reason: "still missing" }]
  };
  assert.deepEqual(decodePostRepairResult(encodePostRepairResult(result)), result);
  assert.equal(decodePostRepairResult("ordinary model error"), null);
});

test("production flow dispatches repair jobs once and rechecks the final candidate", () => {
  const api = readFileSync(new URL("../src/app/api/admin/posts/bulk-repair/route.ts", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../src/worker/post-repair.ts", import.meta.url), "utf8");
  const dispatch = readFileSync(new URL("../src/worker/index.ts", import.meta.url), "utf8");
  assert.match(api, /attempts:\s*1/);
  assert.match(dispatch, /processPostRepair\(fetchJob\.id, postRepair\)/);
  assert.match(worker, /FOR UPDATE/);
  assert.match(worker, /evidenceRevisionForPost\(current\)/);
  assert.match(worker, /const finalAssessment = assessPostPublicationRequest/);
  assert.match(worker, /assessEvidenceClaimConsistency\(draft\.content, evidence\)/);
  assert.match(worker, /publicationBlockedReason:\s*null/);
});
