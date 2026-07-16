import assert from "node:assert/strict";
import test from "node:test";
import {
  PublicVerificationRequiredError,
  buildCreativeDraftFallback,
  buildPublicEvidenceReviewFailedIssues,
  buildPublicEvidenceUnavailableIssues,
  formatScoreArticleSurface,
  formatVerificationClarificationQuestion,
  gatherPublicEvidence,
  generateNextInterviewQuestionFallback,
  isVerificationClarificationQuestion,
  mergePublicEvidenceSearches,
  runPublicVerificationGate,
  scoreCreativeWorkFallback,
  scoreCreativeWork
} from "../src/lib/creation-ai";
import { MAX_SCORABLE_WORK_CONTENT_LENGTH } from "../src/lib/creation-limits";
import type { ExaResult } from "../src/lib/exa";
import {
  buildCreationGoogleNewsFeeds,
  searchCreationEvidenceWithGoogleNews,
  selectRicherCreationEvidenceBody
} from "../src/lib/creation-research";

function exaResult(url: string): ExaResult {
  return { title: url, url, text: "text", publishedDate: null, sourceName: "example.com" };
}

function substantiveArticle(label: string) {
  return Array.from({ length: 16 }, (_, index) =>
    `2026年${index + 1}月，${label}第${index + 1}项公开研究发布了不同样本，报告显示企业采用率变化，并说明了数据来源与统计边界。`
  ).join("\n\n");
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
  assert.match(result.notes[0], /没有可用的联网搜索通道/);
});

test("creation news feeds cover Chinese, global and Bing results with bounded queries", () => {
  const feeds = buildCreationGoogleNewsFeeds([
    "欧洲 AI 初创融资 美国差距",
    "Europe AI startup venture funding gap",
    "third query must be ignored",
    "Europe AI startup venture funding gap"
  ]);

  // 中文查询 → Google zh + Google en + Bing；英文查询 → Google en + Bing。
  assert.equal(feeds.length, 5);
  assert.match(feeds[0].url, /^https:\/\/news\.google\.com\/rss\/search\?/);
  assert.match(decodeURIComponent(feeds[0].url), /欧洲 AI 初创融资 美国差距/);
  assert.match(feeds[0].url, /hl=zh-CN/);
  assert.match(feeds[1].url, /hl=en-US/);
  assert.match(feeds[2].url, /^https:\/\/www\.bing\.com\/news\/search\?/);
  assert.match(feeds[3].url, /hl=en-US/);
  assert.match(feeds[4].url, /^https:\/\/www\.bing\.com\/news\/search\?/);
  // Bing 端点不得携带 setmkt(实测会让 Bing 返回非 RSS 响应)。
  assert.ok(feeds.every((feed) => !feed.url.includes("setmkt")));
});

test("Google News fallback only returns scraped full text, never RSS summaries", async () => {
  const richSummary = substantiveArticle("RSS摘要不应被使用");
  const outcome = await searchCreationEvidenceWithGoogleNews(
    ["Europe AI funding"],
    {
      fetchFeed: async () => [{
        title: "RSS result",
        link: "https://news.google.com/rss/articles/one",
        summary: richSummary,
        date: new Date("2026-07-01T00:00:00Z")
      }],
      scrapePage: async () => ({
        title: "Only a thin landing page",
        content: "Read more",
        markdown: "Read more",
        finalUrl: "https://publisher.example/thin"
      })
    }
  );

  assert.equal(outcome.searchCompleted, true);
  assert.equal(outcome.candidateCount, 1);
  assert.deepEqual(outcome.evidence, []);
});

test("Google News fallback accepts sufficient origin-page bodies and dedupes final URLs", async () => {
  const body = substantiveArticle("正文资料");
  const outcome = await searchCreationEvidenceWithGoogleNews(
    ["欧洲 AI 融资", "Europe AI funding"],
    {
      fetchFeed: async (url) => [{
        title: url.includes("zh-CN") ? "中文聚合标题" : "Global aggregate title",
        link: `${url.includes("zh-CN") ? "https://news.google.com/rss/articles/zh" : "https://news.google.com/rss/articles/en"}`,
        summary: "聚合摘要不能进入证据",
        date: new Date("2026-07-02T00:00:00Z")
      }],
      scrapePage: async () => ({
        title: "Publisher full article",
        content: body,
        markdown: "# Publisher full article",
        finalUrl: "https://publisher.example/full?utm_source=google"
      })
    }
  );

  assert.equal(outcome.evidence.length, 1);
  assert.equal(outcome.evidence[0].url, "https://publisher.example/full");
  assert.equal(outcome.evidence[0].sourceName, "publisher.example");
  assert.match(outcome.evidence[0].text, /正文资料/);
  assert.doesNotMatch(outcome.evidence[0].text, /聚合摘要/);
});

test("richer visible page text wins when markdown extraction only kept a heading", () => {
  const content = substantiveArticle("复杂页面正文");
  assert.equal(selectRicherCreationEvidenceBody("# 标题", content), content);
});

test("Exa 403 falls back to body-level Google News evidence", async () => {
  const fallbackEvidence = [exaResult("https://publisher.example/report")];
  const result = await gatherPublicEvidence(["Europe AI startup funding"], {
    exaConfigured: async () => true,
    searchExa: async () => {
      throw new Error("Exa 搜索请求失败：HTTP 403");
    },
    searchFallback: async () => ({
      evidence: fallbackEvidence,
      searchCompleted: true,
      candidateCount: 3
    })
  });

  assert.deepEqual(result, fallbackEvidence);
});

test("configured search only reports infrastructure failure after fallback is also unavailable", async () => {
  await assert.rejects(
    gatherPublicEvidence(["Europe AI startup funding"], {
      exaConfigured: async () => true,
      searchExa: async () => {
        throw new Error("HTTP 403");
      },
      searchFallback: async () => {
        throw new Error("Google News unreachable");
      }
    }),
    /Google News unreachable/
  );
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

test("optional direction research with no claims does not block quick article composition", async () => {
  const result = await runPublicVerificationGate({
    searchQueries: ["欧洲 AI 创业 融资 监管 算力"],
    factualClaims: [],
    gather: async () => [],
    verify: async () => {
      throw new Error("没有事实性陈述时不应进入核验");
    }
  });

  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.notes, []);
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

test("after one clarification round the gate degrades issues to notes instead of blocking forever", async () => {
  // 回归：每轮核验都可能挑出新的小问题（第一轮"从来不提"、第二轮"是否纯端侧"……），
  // 若始终阻断，创作者永远到不了成稿。创作者回应过一轮后 blocking=false，
  // 剩余疑点连同证据一起返回，转为成稿时的审慎措辞纪律。
  const evidence = [exaResult("https://example.com/a"), exaResult("https://example.com/b")];
  const result = await runPublicVerificationGate({
    searchQueries: ["某公司 2026 政策"],
    factualClaims: ["某公司在 2026 年发布了政策"],
    blocking: false,
    gather: async () => evidence,
    verify: async () => [{
      claim: "某公司在 2026 年发布了政策",
      finding: "资料只能部分确认",
      evidence: "公开资料 1",
      requiredAction: "写成受访者个人判断"
    }]
  });

  assert.equal(result.evidence.length, 2, "非阻断模式必须保留已检索证据供成稿引用");
  assert.equal(result.notes.length, 2);
  assert.match(result.notes[0], /不再阻断成稿/);
  assert.match(result.notes[1], /资料只能部分确认/);
});

test("non-blocking mode also converts zero-result verification failures into notes", async () => {
  const result = await runPublicVerificationGate({
    searchQueries: ["某公司 2026 政策"],
    factualClaims: ["某公司在 2026 年发布了政策"],
    blocking: false,
    gather: async () => [],
    verify: async () => []
  });

  assert.equal(result.evidence.length, 0);
  assert.equal(result.notes.length, 2);
  assert.match(result.notes[1], /没有取得可用于核验的资料/);
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

test("scoring refuses an oversized body instead of hashing unreviewed trailing content", async () => {
  await assert.rejects(
    scoreCreativeWork({
      genreName: "观点评论",
      dimensions: [{ key: "rigor", label: "严谨性", weight: 1, hint: "论证" }],
      threshold: 70,
      depth: "SHORT",
      title: "不能只评分开头",
      summary: "完整摘要也必须与正文一并评分",
      content: "合格开头".padEnd(MAX_SCORABLE_WORK_CONTENT_LENGTH + 1, "x")
    }),
    /拒绝只评分截断片段/
  );
});

test("scoring prompt surface explicitly includes the public summary", () => {
  const formatted = formatScoreArticleSurface({
    title: "标题",
    summary: "这段摘要也必须受评",
    content: "正文"
  });
  assert.match(formatted, /【公开摘要】\n这段摘要也必须受评/);
  assert.match(formatted, /【正文】\n正文/);
});

test("provider outage fallback draft preserves user answers without inventing material", () => {
  const draft = buildCreativeDraftFallback({
    topic: "  # 一次真实的迁移复盘  ",
    interview: [
      { question: "当时发生了什么？", answer: "凌晨两点，旧服务开始返回 502。" },
      { question: "你做了什么？", answer: "我先切回旧版本，再逐项核对日志。" }
    ]
  });

  assert.equal(draft.title, "一次真实的迁移复盘");
  assert.match(draft.content, /凌晨两点，旧服务开始返回 502。/);
  assert.match(draft.content, /我先切回旧版本，再逐项核对日志。/);
  assert.doesNotMatch(draft.content, /数据库损坏|用户流失/);
  assert.match(draft.notes.join("\n"), /保底草稿/);
});

test("provider outage interview fallback asks bounded useful questions and finishes at the minimum", () => {
  const first = generateNextInterviewQuestionFallback({
    mode: "AI_FIRST",
    depth: "SHORT",
    topic: "一次迁移复盘",
    interview: []
  });
  assert.equal(first.done, false);
  if (!first.done) assert.match(first.question, /一次迁移复盘/);

  const finished = generateNextInterviewQuestionFallback({
    mode: "AI_FIRST",
    depth: "SHORT",
    topic: "一次迁移复盘",
    interview: [
      { question: "核心是什么？", answer: "先验证再切换。" },
      { question: "具体发生了什么？", answer: "先灰度了一台机器。" }
    ]
  });
  assert.deepEqual(finished, { done: true });
});

test("provider outage fallback review is explicit and cannot pass the normal threshold", () => {
  const result = scoreCreativeWorkFallback({
    dimensions: [
      { key: "clarity", label: "清晰度", weight: 0.6, hint: "结构清楚" },
      { key: "evidence", label: "依据", weight: 0.4, hint: "有具体依据" }
    ],
    depth: "FULL",
    content: Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 段具体素材。`.padEnd(110, "细节")).join("\n\n")
  });

  assert.ok(result.total <= 69);
  assert.ok(result.dimensionScores.every((dimension) => dimension.score <= 69));
  assert.match(result.overallComment, /未把临时检查冒充正式 AI 评分/);
  assert.match(result.suggestions.join("\n"), /重新评分/);
});
