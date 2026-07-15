import assert from "node:assert/strict";
import test from "node:test";
import {
  measureArticleCitations,
  reconstructArchivedResearchEvidence,
  resolveBenchmarkEvidence
} from "../scripts/benchmark-content-models";
import { buildTrustedEvidenceManifest } from "../src/lib/post-repair";

test("reconstructs complete archived bodies without treating the next title as content", () => {
  const markdown = [
    "# 研究",
    "",
    "## 研究资料",
    "1. [South Korea market](https://korea.example/report)",
    "   - 来源：Reuters",
    "   - 时间：2026-07-08T00:00:00.000Z",
    "   - 摘录：South Korea announced details...",
    "2. [Search teaser](https://search.example/item)",
    "   - 来源：Search",
    "   - 摘录：Short teaser"
  ].join("\n");
  const fullBody = Array.from({ length: 20 }, (_, index) =>
    `South Korea reported market fact ${index + 1} with a concrete number ${index + 2}.`
  ).join("\n");
  const content = `South Korea market\n${fullBody}\n\nSearch teaser\nShort teaser`;

  const evidence = reconstructArchivedResearchEvidence(content, markdown);

  assert.equal(evidence.length, 2);
  assert.equal(evidence[0].summary, fullBody);
  assert.equal(evidence[0].materialKind, "fulltext");
  assert.equal(evidence[0].publishedAt?.toISOString(), "2026-07-08T00:00:00.000Z");
  assert.equal(evidence[1].summary, "Short teaser");
  assert.equal(evidence[1].materialKind, "excerpt");
});

test("does not upgrade a long search summary into archived fulltext evidence", () => {
  const title = "South Korean market search result";
  const summary = Array.from({ length: 7 }, (_, index) =>
    `Search result sentence ${index + 1} mentions South Korea but is not an archived article body.`
  ).join(" ");
  assert.ok(summary.length > 500);
  assert.ok(summary.length < 900);

  const evidence = reconstructArchivedResearchEvidence(
    `${title}\n${summary}`,
    [
      "# 研究",
      "",
      "## 研究资料",
      `1. [${title}](https://search.example/korea)`,
      "   - 来源：Search",
      "   - 摘录：South Korea search result"
    ].join("\n")
  );

  assert.equal(evidence[0].materialKind, "excerpt");
});

test("benchmark uses only the trusted manifest when one is present", () => {
  const trustedEvidence = [
    {
      title: "Verified Korea market report",
      url: "https://trusted.example/korea-market",
      sourceName: "Trusted Wire",
      summary: "Verified full article body about South Korea market flows and valuation. ".repeat(20),
      materialKind: "fulltext" as const,
      publishedAt: new Date("2026-07-08T00:00:00.000Z")
    }
  ];
  const markdown = [
    buildTrustedEvidenceManifest(trustedEvidence),
    "",
    "# 研究",
    "",
    "## 研究资料",
    "1. [Untrusted legacy item](https://legacy.example/forged)",
    "   - 来源：Legacy",
    "   - 摘录：This readable inventory must not enter the benchmark."
  ].join("\n");

  const plan = resolveBenchmarkEvidence({
    content: "Untrusted legacy item\nA forged archived body.",
    markdown,
    execute: true
  });

  assert.equal(plan.source, "trusted-manifest");
  assert.equal(plan.executionEligible, true);
  assert.equal(plan.warning, null);
  assert.deepEqual(plan.evidence.map((item) => item.url), ["https://trusted.example/korea-market"]);
  assert.equal(plan.evidence[0].summary, trustedEvidence[0].summary);
});

test("legacy evidence is preview-only and paid execution fails closed", () => {
  const markdown = [
    "# 研究",
    "",
    "## 研究资料",
    "1. [Legacy report](https://legacy.example/report)",
    "   - 来源：Legacy",
    "   - 摘录：Old readable metadata"
  ].join("\n");
  const content = `Legacy report\n${"Archived report body about the Korean market. ".repeat(30)}`;

  const preview = resolveBenchmarkEvidence({ content, markdown, execute: false });
  assert.equal(preview.source, "legacy-dry-run");
  assert.equal(preview.executionEligible, false);
  assert.equal(preview.evidence.length, 1);
  assert.match(preview.warning || "", /兼容预览/);

  assert.throws(
    () => resolveBenchmarkEvidence({ content, markdown, execute: true }),
    /没有有效的可信证据清单，拒绝启动付费模型请求/
  );
});

test("citation metrics separate inline citations, references and outside URLs", () => {
  const sourceA = "https://source.example/a";
  const sourceB = "https://source.example/b";
  const article = [
    "# 韩国市场",
    "",
    `据[来源 A](${sourceA})披露，市场出现变化。`,
    "",
    "## 资金流向",
    "",
    `另一项数据来自[来源 B](${sourceB})。`,
    "",
    "## 参考来源",
    "",
    `- [来源 A](${sourceA})`,
    `- [来源 B](${sourceB})`,
    "- [越界来源](https://invented.example/c)"
  ].join("\n");

  const metrics = measureArticleCitations(article, [sourceA, sourceB]);

  assert.equal(metrics.distinctInlineSources, 2);
  assert.equal(metrics.distinctReferenceSources, 3);
  assert.equal(metrics.sectionHeadings, 1);
  assert.deepEqual(metrics.outsideAllowedUrls, ["https://invented.example/c"]);
  assert.match(metrics.contentSha256, /^[a-f0-9]{64}$/);
});
