import assert from "node:assert/strict";
import test from "node:test";
import {
  PublicVerificationRequiredError,
  buildPublicEvidenceReviewFailedIssues,
  buildPublicEvidenceUnavailableIssues,
  formatVerificationClarificationQuestion,
  isVerificationClarificationQuestion,
  mergePublicEvidenceSearches,
  runPublicVerificationGate
} from "../src/lib/creation-ai";
import type { ExaResult } from "../src/lib/exa";

function exaResult(url: string): ExaResult {
  return { title: url, url, text: "text", publishedDate: null, sourceName: "example.com" };
}

test("missing public evidence creates clarification issues instead of passing silently", () => {
  const issues = buildPublicEvidenceUnavailableIssues({
    claims: ["某公司在 2026 年发布了某项政策"],
    searchQueries: ["某公司 2026 政策 发布"]
  });

  assert.equal(issues.length, 1);
  assert.match(issues[0].finding, /没有取得可用于核验的资料/);
  assert.match(issues[0].requiredAction, /补充可靠来源/);
});

test("missing public evidence still blocks when the model only produced search queries", () => {
  const issues = buildPublicEvidenceUnavailableIssues({
    claims: [],
    searchQueries: ["某 CEO 原子弹爆炸 模型 发布会"]
  });

  assert.equal(issues.length, 1);
  assert.match(issues[0].claim, /需要核验的公开信息/);
  assert.match(issues[0].evidence, /某 CEO 原子弹爆炸/);
  assert.match(issues[0].requiredAction, /重新成稿/);
});

test("failed public evidence review creates user-facing clarification issues", () => {
  const issues = buildPublicEvidenceReviewFailedIssues({
    claims: ["某 CEO 评价了某个模型"],
    evidence: [{
      title: "Example",
      url: "https://example.com/report",
      text: "report text",
      publishedDate: null,
      sourceName: "example.com"
    }]
  });

  assert.equal(issues.length, 1);
  assert.match(issues[0].finding, /自动核验步骤没有可靠完成/);
  assert.match(issues[0].evidence, /example\.com/);
});

test("verification clarification question asks the user to fix or explain before retrying", () => {
  const question = formatVerificationClarificationQuestion([{
    claim: "某公开事实",
    finding: "无法确认",
    evidence: "搜索查询",
    requiredAction: "请补充来源"
  }]);

  assert.match(question, /整改或解释/);
  assert.match(question, /重新联网搜索并再次核验/);
  assert.match(question, /某公开事实/);
});

test("exa disabled skips verification with a note instead of blocking compose", async () => {
  const result = await runPublicVerificationGate({
    searchQueries: ["某公司 2026 政策"],
    factualClaims: ["某公司在 2026 年发布了政策"],
    gather: async () => null,
    verify: async () => {
      throw new Error("Exa 未启用时不应该进入核验步骤");
    }
  });

  assert.equal(result.evidence.length, 0);
  assert.equal(result.notes.length, 1);
  assert.match(result.notes[0], /未启用联网搜索/);
});

test("configured exa with zero results blocks compose for clarification", async () => {
  await assert.rejects(
    runPublicVerificationGate({
      searchQueries: ["某公司 2026 政策"],
      factualClaims: ["某公司在 2026 年发布了政策"],
      gather: async () => [],
      verify: async () => []
    }),
    (error: unknown) =>
      error instanceof PublicVerificationRequiredError &&
      /没有取得可用于核验的资料/.test(error.issues[0].finding)
  );
});

test("verification issues found against evidence block compose", async () => {
  await assert.rejects(
    runPublicVerificationGate({
      searchQueries: ["某公司 2026 政策"],
      factualClaims: ["某公司在 2026 年发布了政策"],
      gather: async () => [exaResult("https://example.com/a")],
      verify: async () => [{
        claim: "某公司在 2026 年发布了政策",
        finding: "资料显示是 2025 年",
        evidence: "公开资料 1",
        requiredAction: "请修正时间"
      }]
    }),
    (error: unknown) =>
      error instanceof PublicVerificationRequiredError && /2025/.test(error.issues[0].finding)
  );
});

test("verify step failure blocks with review-failed issues instead of passing silently", async () => {
  await assert.rejects(
    runPublicVerificationGate({
      searchQueries: ["某公司 2026 政策"],
      factualClaims: ["某公司在 2026 年发布了政策"],
      gather: async () => [exaResult("https://example.com/a")],
      verify: async () => {
        throw new Error("model down");
      }
    }),
    (error: unknown) =>
      error instanceof PublicVerificationRequiredError &&
      /自动核验步骤没有可靠完成/.test(error.issues[0].finding)
  );
});

test("clean verification passes evidence through without notes", async () => {
  const evidence = [exaResult("https://example.com/a"), exaResult("https://example.com/b")];
  const result = await runPublicVerificationGate({
    searchQueries: ["某公司 2026 政策"],
    factualClaims: ["某公司在 2026 年发布了政策"],
    gather: async () => evidence,
    verify: async () => []
  });

  assert.equal(result.evidence.length, 2);
  assert.equal(result.notes.length, 0);
});

test("merge throws when every evidence search fails (infrastructure, not user's facts)", () => {
  assert.throws(
    () =>
      mergePublicEvidenceSearches([
        { status: "rejected", reason: new Error("HTTP 500") },
        { status: "rejected", reason: new Error("HTTP 500") }
      ]),
    /公开资料搜索失败/
  );
});

test("merge tolerates partial failures, dedupes by url, and caps at five", () => {
  const merged = mergePublicEvidenceSearches([
    { status: "rejected", reason: new Error("HTTP 500") },
    {
      status: "fulfilled",
      value: [
        exaResult("https://example.com/1"),
        exaResult("https://example.com/1"),
        exaResult("https://example.com/2"),
        exaResult("https://example.com/3"),
        exaResult("https://example.com/4"),
        exaResult("https://example.com/5"),
        exaResult("https://example.com/6")
      ]
    }
  ]);

  assert.equal(merged.length, 5);
  assert.equal(new Set(merged.map((item) => item.url)).size, 5);
});

test("verification clarification questions are distinguishable from normal interview questions", () => {
  const question = formatVerificationClarificationQuestion([{
    claim: "某公开事实",
    finding: "无法确认",
    evidence: "搜索查询",
    requiredAction: "请补充来源"
  }]);

  assert.equal(isVerificationClarificationQuestion(question), true);
  assert.equal(isVerificationClarificationQuestion("你当时最想表达的一句话是什么？"), false);
  assert.equal(isVerificationClarificationQuestion(null), false);
});
