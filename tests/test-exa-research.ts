import assert from "node:assert/strict";
import test from "node:test";
import { buildExaDomainFilter, type ExaResult } from "../src/lib/exa";
import { collectExaQueryEvidence } from "../src/worker/evidence";

function result(url: string): ExaResult {
  return { url, title: url, text: "Collected source text", publishedDate: null, sourceName: new URL(url).hostname };
}

test("international Exa research no longer excludes primary institutions and papers", () => {
  const filter = buildExaDomainFilter({ internationalOnly: true });
  assert.equal(filter.includeDomains, undefined);
  for (const host of ["boj.or.jp", "ecb.europa.eu", "ec.europa.eu", "iea.org", "arxiv.org", "mit.edu"]) {
    assert.equal(filter.excludeDomains?.some((domain) => host === domain || host.endsWith(`.${domain}`)), false);
  }
  assert.ok(filter.excludeDomains?.includes("news.cn"));
  assert.ok(buildExaDomainFilter({ domesticOnly: true }).includeDomains?.includes("news.cn"));
  assert.deepEqual(buildExaDomainFilter(), {});
});

test("Exa searches all planned angles serially and interleaves official results before the fetch budget is exhausted", async () => {
  const calls: string[] = [];
  let active = 0;
  const evidence = await collectExaQueryEvidence(["latest news", "official decision", "independent review", "extra query"], "international", undefined, async (query, opts) => {
    calls.push(query);
    assert.equal(++active, 1);
    assert.equal(opts?.numResults, 5);
    assert.equal(opts?.internationalOnly, true);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    const host = query === "official decision" ? "boj.or.jp" : query === "latest news" ? "news.example" : "review.example";
    return Array.from({ length: 5 }, (_, index) => result(`https://${host}/${index}`));
  });
  assert.deepEqual(calls, ["latest news", "official decision", "independent review"]);
  assert.deepEqual(evidence.slice(0, 3).map((item) => new URL(item.url).hostname), ["news.example", "boj.or.jp", "review.example"]);
  assert.equal(evidence.length, 15);
  assert.ok(evidence.every((item) => item.materialKind === "excerpt"), "search results must still pass the body-evidence gate");
});

test("failed queries preserve successful evidence and count transient failures", async () => {
  let failures = 0;
  const evidence = await collectExaQueryEvidence(["broken query", "official query", "official query"], "domestic", () => { failures++; }, async (query, opts) => {
    assert.equal(opts?.domesticOnly, true);
    if (query === "broken query") throw new Error("temporary search outage");
    return [result("https://news.cn/report"), result("https://news.cn/report")];
  });
  assert.equal(failures, 1);
  assert.equal(evidence.length, 1);
});


test("current research bounds the first two queries but retains a historical background angle", async () => {
  const dates: Array<string | undefined> = [];
  await collectExaQueryEvidence(["latest rates", "policy decision", "financing mechanism"], "international", undefined, async (_, opts) => {
    dates.push(opts?.startPublishedDate);
    return [];
  }, "日本央行 利率政策 日元汇率 企业融资", new Date("2026-10-05T00:00:00Z"));
  assert.deepEqual(dates, ["2026-04-08T00:00:00.000Z", "2026-04-08T00:00:00.000Z", undefined]);
});
