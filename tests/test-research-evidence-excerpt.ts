import assert from "node:assert/strict";
import test from "node:test";
import { researchSearchStartDate, selectResearchEvidenceExcerpt } from "../src/lib/research-evidence-excerpt";
import { normalizeResearchSearchQueries } from "../src/lib/ai";

test("official front matter does not consume the whole model evidence budget", () => {
  const front = "Policy Board members present and meeting attendance. ".repeat(60);
  const body = "Interest rates increased. Corporate financing and lending conditions remained accommodative. The yen exchange rate was volatile. However, the effect on credit remains uncertain.";
  const source = front + "\n\n" + body + "\n\n" + "Appendix. ".repeat(100);
  const excerpt = selectResearchEvidenceExcerpt(source, "Bank Japan interest rates corporate financing lending yen exchange rate credit", 500);
  assert.match(excerpt, /Corporate financing/);
  assert.match(excerpt, /remains uncertain/);
  assert.ok(excerpt.length <= 500);
  assert.ok(source.includes(excerpt.replace(/^\[…]\n/, "")), "passage must be a contiguous verbatim source span");
});

test("small or unmatched sources keep their beginning and are never fabricated", () => {
  assert.equal(selectResearchEvidenceExcerpt("Original source.", "credit", 500), "Original source.");
  const source = "Original source. ".repeat(100);
  const excerpt = selectResearchEvidenceExcerpt(source, "absent keyword", 300);
  assert.ok(source.startsWith(excerpt));
  assert.ok(excerpt.length <= 300);
});

test("explicit historical research is not silently constrained to the present", () => {
  const now = new Date("2026-10-05T00:00:00Z");
  for (const keyword of ["日本央行 2009 企业融资", "日本央行 历史演变", "BOJ historical policy", "2024年日元汇率"]) {
    assert.equal(researchSearchStartDate(keyword, now), undefined, keyword);
  }
  assert.equal(researchSearchStartDate("日本央行 利率政策", now), "2026-04-08T00:00:00.000Z");
});

test("Japanese monetary research keeps its financing and currency angles when AI query expansion is unavailable", () => {
  const queries = normalizeResearchSearchQueries([], "日本央行 利率政策 日元汇率 企业融资");
  assert.ok(queries.some((query) => /corporate financing/.test(query) && /yen exchange rate/.test(query)));
});


test("citation repair can see the numeric fact beyond a source introduction", () => {
  const text = "Energy market report introduction. ".repeat(100) + "\n\nStorage held 72.4% of the total 1,132 TWh capacity. This is not a winter supply guarantee.\n\n" + "Methodology. ".repeat(100);
  const excerpt = selectResearchEvidenceExcerpt(text, "占总容量1132太瓦时的72.4%", 400);
  assert.match(excerpt, /72\.4%/);
  assert.match(excerpt, /1,132 TWh/);
  assert.match(excerpt, /not a winter supply guarantee/);
});


test("EU regulatory research keeps the jurisdiction and investment angle in deterministic English queries", () => {
  const queries = normalizeResearchSearchQueries([], "欧洲人工智能监管 合规成本 创新投资 监管实施");
  assert.ok(queries.some((query) => /EU AI Act regulation/i.test(query) && /innovation investment/i.test(query) && /regulatory implementation/i.test(query)));
});
