import assert from "node:assert/strict";
import test from "node:test";
import {
  assessEvidenceSufficiency,
  assessGeneratedArticle,
  assessSourceMaterial,
  assessSourceSufficiency,
  assertPublishableGeneratedArticle,
  assertUsableSourceMaterial,
  filterUsableEvidenceItems,
  InvalidSourceMaterialError,
  RetryableSourceFetchError,
  UnpublishableGeneratedArticleError
} from "../src/lib/source-quality";
import {
  isInsufficientEvidenceOutput,
  normalizeGeneratedArticleMarkdown,
  normalizeResearchSearchQueries
} from "../src/lib/ai";
import {
  buildDigestFallback,
  buildResearchFallbackDraft,
  buildSearchFeeds,
  evidenceFromExaResult,
  normalizeSearchQueries,
  selectWritingEvidence,
  selectRicherEvidenceBody
} from "../src/worker/evidence";

function factualSourceText(subject: string, count = 18) {
  return Array.from({ length: count }, (_, index) =>
    `2026年7月${(index % 20) + 1}日，${subject}确认第${index + 1}项安排开始实施，涉及${index + 2}个执行环节，并公布对应责任主体。`
  ).join("\n");
}

test("recognizes evidence-insufficient sentinels before targeted repair", () => {
  assert.equal(isInsufficientEvidenceOutput("INSUFFICIENT_EVIDENCE: 缺少正文级来源"), true);
  assert.equal(isInsufficientEvidenceOutput("“INSUFFICIENT_EVIDENCE: 资料无法交叉核验"), true);
  assert.equal(isInsufficientEvidenceOutput("# 一篇正常文章"), false);
});

test("diagnostic research and digest fallbacks are categorically unpublishable", () => {
  const evidence = Array.from({ length: 5 }, (_, index) => ({
    title: `来源 ${index + 1}`,
    url: `https://source${index + 1}.example/report`,
    sourceName: `机构 ${index + 1}`,
    summary: factualSourceText(`资料 ${index + 1}`, 20),
    materialKind: "fulltext" as const
  }));
  for (const draft of [
    buildResearchFallbackDraft("测试选题", "国外", evidence, new Error("格式未通过")),
    buildDigestFallback("测试主题", "周报综述", "过去 7 天", "国外", evidence, new Error("格式未通过"))
  ]) {
    const assessment = assessGeneratedArticle(draft, {
      allowedSourceUrls: evidence.map((item) => item.url),
      requireInlineCitation: true,
      minimumDistinctInlineSources: 2
    });
    assert.equal(assessment.ok, false);
    if (!assessment.ok) assert.match(assessment.reason, /诊断稿不可发布/);
  }
});

test("writing evidence excludes snippets and off-topic full text for anchored research", () => {
  const selected = selectWritingEvidence([
    {
      title: "Vietnam stocks offer opportunities in H2",
      url: "https://vietnam.example/market",
      sourceName: "Vietnam outlet",
      summary: factualSourceText("Vietnam market", 20),
      materialKind: "fulltext" as const
    },
    {
      title: "South Korea monitors stock-market volatility",
      url: "https://korea.example/volatility",
      sourceName: "Reuters",
      summary: factualSourceText("South Korea KOSPI foreign investors", 20),
      materialKind: "fulltext" as const
    },
    {
      title: "South Korean market analysis",
      url: "https://snippet.example/korea",
      sourceName: "Search",
      summary: "South Korean market analysis",
      materialKind: "excerpt" as const,
      discoveryMethod: "google-news" as const
    }
  ], "韩国股市 估值 风险 外资流向 2026 下半年 预测");

  assert.deepEqual(selected.map((item) => item.url), ["https://korea.example/volatility"]);
});

test("combined entity anchors require both Korea and Samsung", () => {
  const selected = selectWritingEvidence([
    {
      title: "Samsung expands semiconductor production",
      url: "https://global.example/samsung",
      sourceName: "Global outlet",
      summary: factualSourceText("Samsung semiconductor business", 20),
      materialKind: "fulltext" as const
    },
    {
      title: "South Korea and Samsung semiconductor outlook",
      url: "https://korea.example/samsung",
      sourceName: "Korea outlet",
      summary: factualSourceText("South Korea Samsung semiconductor exports", 20),
      materialKind: "fulltext" as const
    }
  ], "韩国半导体 三星 2026 股价 消费电子 出口 市场情绪");
  assert.deepEqual(selected.map((item) => item.url), ["https://korea.example/samsung"]);
});

test("rejects HTTP error responses before article generation", () => {
  const assessment = assessSourceMaterial({
    title: "403 Forbidden",
    httpStatus: 403,
    content: "403 Forbidden Zen/4.3"
  });

  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /403|访问受限/);
});

test("classifies temporary source HTTP failures separately from permanent pages", () => {
  assert.throws(
    () => assertUsableSourceMaterial({ httpStatus: 503, title: "Service Unavailable" }),
    RetryableSourceFetchError
  );
  assert.throws(
    () => assertUsableSourceMaterial({ httpStatus: 404, title: "Not Found" }),
    InvalidSourceMaterialError
  );
});

test("rejects soft error pages returned as page text", () => {
  const assessment = assessSourceMaterial({
    title: "403 Forbidden",
    content: "403 Forbidden Zen/4.3"
  });

  assert.equal(assessment.ok, false);
});

test("keeps real articles that merely mention an HTTP error", () => {
  const assessment = assessSourceMaterial({
    title: "网站运维团队解释 403 Forbidden 的排查方法",
    content: [
      "一家云服务团队发布技术复盘，解释用户访问 API 时遇到 403 Forbidden 的原因。",
      "文章给出了权限配置、签名校验、反向代理规则和日志定位方法，并列出后续修复计划。"
    ].join("")
  });

  assert.equal(assessment.ok, true);
});

test("filters invalid evidence items before synthesis", () => {
  const evidence = filterUsableEvidenceItems([
    {
      title: "403 Forbidden",
      url: "https://www.thepaper.cn/",
      summary: "403 Forbidden Zen/4.3"
    },
    {
      title: "OpenAI 发布新模型",
      url: "https://example.com/ai",
      summary: "公司介绍了新模型的推理能力、价格和 API 上线计划。"
    }
  ]);

  assert.deepEqual(evidence.map((item) => item.title), ["OpenAI 发布新模型"]);
});

test("rejects generated drafts that only explain an invalid source page", () => {
  const generated = [
    "# 澎湃新闻链接返回 403 Forbidden，原始内容暂无法核验",
    "",
    "给定来源链接指向澎湃新闻网站，但当前可见页面仅显示“403 Forbidden”和“Zen/4.3”。",
    "因此，基于现有材料无法形成关于具体新闻事件的事实报道。",
    "",
    "## 参考来源",
    "- [澎湃新闻页面](https://www.thepaper.cn/)"
  ].join("\n");

  const assessment = assessGeneratedArticle(generated);
  assert.equal(assessment.ok, false);
});

test("rejects a title and ellipsis even when it is not an HTTP error", () => {
  const assessment = assessSourceSufficiency({
    url: "https://example.com/post",
    title: "Hidden Open Thread 440.5",
    content: "Hidden Open Thread 440.5 ...",
    markdown: "# Hidden Open Thread 440.5\n\n..."
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /不足以支撑|省略号/);
});

test("accepts a substantive single-source article", () => {
  const assessment = assessSourceSufficiency({
    url: "https://example.com/post",
    title: "产品迁移公告",
    markdown: `# 产品迁移公告\n\n${factualSourceText("官方公告")}`
  });
  assert.equal(assessment.ok, true);
});

test("rejects repeated promotional copy without distinct verifiable facts", () => {
  const repeated = "该方案具有行业价值并将持续赋能生态发展。".repeat(80);
  const assessment = assessSourceSufficiency({
    url: "https://example.com/promo",
    title: "产品介绍",
    markdown: repeated
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /有效信息|可核验/);
});

test("rejects a link-heavy channel index even when it contains lots of text", () => {
  const links = Array.from({ length: 50 }, (_, index) =>
    `[第 ${index + 1} 条栏目新闻及其较长标题与频道说明](https://example.com/news/${index + 1})`
  ).join("\n\n");
  const assessment = assessSourceSufficiency({
    url: "https://example.com/channel/",
    title: "频道首页",
    markdown: `# 频道首页\n\n${links}`
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /首页|导航/);
});

test("multi-source evidence must have enough substantive material", () => {
  const thin = assessEvidenceSufficiency([
    { title: "标题一", url: "https://one.example/a", summary: "..." },
    { title: "标题二", url: "https://two.example/b", summary: "阅读全文" }
  ]);
  assert.equal(thin.ok, false);

  const rich = assessEvidenceSufficiency([
    { title: "来源一", url: "https://one.example/a", summary: factualSourceText("机构甲"), materialKind: "fulltext" },
    { title: "来源二", url: "https://two.example/b", summary: factualSourceText("机构乙"), materialKind: "fulltext" }
  ]);
  assert.equal(rich.ok, true);
});

test("duplicate evidence text from different URLs counts only once", () => {
  const duplicated = factualSourceText("同一公告");
  const assessment = assessEvidenceSufficiency([
    { title: "原站", url: "https://one.example/a", summary: duplicated, materialKind: "fulltext" },
    { title: "转载", url: "https://two.example/b", summary: duplicated, materialKind: "fulltext" }
  ], { minItems: 2, strongSingleItemChars: null, minFullTextItems: 1 });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /只有 1 条实质资料/);
});

test("Exa search text remains an excerpt regardless of length", () => {
  const evidence = evidenceFromExaResult({
    title: "搜索结果",
    url: "https://example.com/story",
    sourceName: "example.com",
    text: factualSourceText("搜索摘要", 40),
    publishedDate: new Date("2026-07-11T00:00:00Z")
  });
  assert.equal(evidence.materialKind, "excerpt");
});

test("research query expansion prefers concise multilingual queries without losing fallback", () => {
  const original = "欧洲 AI 初创企业 风险资本融资不足 与美国融资差距 2024 2025 最新数据 PitchBook Atomico Dealroom";
  const queries = normalizeResearchSearchQueries([
    "European AI startup venture capital US funding gap",
    "Europe AI funding official report Atomico Dealroom",
    "European AI startups move to US venture capital"
  ], original);

  assert.equal(queries.length, 4);
  assert.equal(queries[0], "European AI startup venture capital US funding gap");
  assert.ok(queries.includes("欧洲 AI 初创企业 风险资本融资不足 与美国融资差距 PitchBook Atomico Dealroom"));
});

test("Google News feed builder uses expanded queries instead of only the long writing task", () => {
  const queries = normalizeSearchQueries([
    "European AI startup venture capital US funding gap",
    "Europe AI funding official report"
  ], "一段很长的中文任务说明");
  const feeds = buildSearchFeeds(queries, "international");

  assert.ok(feeds.length >= 3);
  assert.ok(feeds.some((feed) => decodeURIComponent(feed.url).includes("European AI startup venture capital US funding gap")));
  assert.ok(feeds.some((feed) => decodeURIComponent(feed.url).includes("Europe AI funding official report")));
  assert.ok(feeds.some((feed) => feed.url.includes("ceid=US:en")));
});

test("deterministic research fallback loosens and translates Chinese queries after a model outage", () => {
  const queries = normalizeResearchSearchQueries([], "欧洲 AI 初创融资 风险资本 美国差距");
  assert.ok(queries.includes("欧洲 AI 初创融资 风险资本"));
  assert.ok(queries.includes("欧洲 AI 初创融资"));
  assert.ok(queries.some((query) => /Europe.*AI.*funding.*venture capital.*US gap/i.test(query)));
});

test("deterministic international fallback translates the exact Korea market task", () => {
  const queries = normalizeResearchSearchQueries([], "韩国股市 估值 风险 外资流向 2026 下半年 预测");
  assert.ok(queries.some((query) => /South Korea stock market/i.test(query)));
  assert.ok(queries.some((query) => /valuation/i.test(query)));
});

test("international search adds a Chinese discovery feed for CJK input without treating snippets as full text", () => {
  const feeds = buildSearchFeeds(["欧洲 AI 初创融资", "Europe AI startup funding"], "international");
  assert.ok(feeds.some((feed) => feed.url.includes("ceid=CN:zh-Hans")));
  assert.ok(feeds.some((feed) => feed.url.includes("ceid=US:en")));
  assert.ok(feeds.some((feed) => decodeURIComponent(feed.url).includes("Europe AI startup funding site:reuters.com")));
});

test("evidence enrichment keeps the richer visible scrape representation", () => {
  const content = factualSourceText("完整正文", 12);
  assert.equal(selectRicherEvidenceBody("# 只有标题", content), content);

  const markdown = `# 完整 Markdown\n\n${factualSourceText("Markdown 正文", 12)}`;
  assert.equal(selectRicherEvidenceBody(markdown, "一行摘要"), markdown);
});

test("long search excerpts do not substitute for fetched full text", () => {
  const text = "这是一条较长搜索摘要，包含主体、日期、动作和若干背景信息，但并不是已抓取的完整正文。".repeat(20);
  const excerptOnly = assessEvidenceSufficiency([
    { title: "来源一", url: "https://one.example/a", summary: text, materialKind: "excerpt" },
    { title: "来源二", url: "https://two.example/b", summary: text, materialKind: "excerpt" }
  ], { minFullTextItems: 1 });
  assert.equal(excerptOnly.ok, false);
  if (!excerptOnly.ok) assert.match(excerptOnly.reason, /正文级资料/);
});

test("substantive Exa page extracts count as body-level evidence when origin fetch is blocked", () => {
  const assessment = assessEvidenceSufficiency([
    {
      title: "机构甲公布执行安排",
      url: "https://one.example/a",
      summary: factualSourceText("机构甲", 20),
      materialKind: "excerpt",
      discoveryMethod: "exa"
    },
    {
      title: "机构乙披露配套规则",
      url: "https://two.example/b",
      summary: factualSourceText("机构乙", 20),
      materialKind: "excerpt",
      discoveryMethod: "exa"
    }
  ], { minItems: 2, minFullTextItems: 2, strongSingleItemChars: null });

  assert.equal(assessment.ok, true);
});

test("RSS teasers do not become body-level evidence merely by being long", () => {
  const assessment = assessEvidenceSufficiency([
    {
      title: "转载一",
      url: "https://one.example/rss",
      summary: factualSourceText("同一 RSS", 20),
      materialKind: "excerpt",
      discoveryMethod: "rss"
    }
  ], { minItems: 1, minFullTextItems: 1 });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /正文级资料/);
});

test("rejects insufficient-evidence sentinel instead of publishing it", () => {
  const assessment = assessGeneratedArticle("INSUFFICIENT_EVIDENCE: 只有标题，没有正文");
  assert.equal(assessment.ok, false);
});

test("publication gate accepts a sourced, non-template article", () => {
  const sourceUrl = "https://example.com/report_(final)";
  const paragraph = "公告确认了实施主体、时间范围和具体动作。文章据此解释执行条件，同时把来源主张与编辑分析分开，未把尚无证据的结果写成事实。";
  const article = [
    "# 一项新安排如何改变现有流程",
    "",
    `据[官方公告](${sourceUrl})，新安排将在明确的时间窗口内实施，适用对象和责任边界也已公布。`,
    "",
    "## 变化落在执行环节",
    "",
    paragraph.repeat(4),
    "",
    "## 适用范围决定实际效果",
    "",
    paragraph.repeat(3),
    "",
    "## 参考来源",
    "",
    `- [官方公告](${sourceUrl})`
  ].join("\n");
  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [sourceUrl],
    requireInlineCitation: true
  });
  assert.equal(assessment.ok, true);
});

test("publication gate rejects invented links and fixed summary templates", () => {
  const paragraph = "这段正文包含可读的信息和必要解释，用于确保文章长度达到基础验收范围。".repeat(8);
  const invented = [
    "# 标题",
    "",
    `[来源](https://invented.example/story)${paragraph}`,
    "",
    "## 具体变化",
    "",
    paragraph,
    "",
    "## 参考来源",
    "- [来源](https://invented.example/story)"
  ].join("\n");
  assert.equal(assessGeneratedArticle(invented, {
    allowedSourceUrls: ["https://allowed.example/story"],
    requireInlineCitation: true
  }).ok, false);

  const templated = [
    "# 标题",
    "",
    paragraph,
    "",
    "## 摘要",
    paragraph,
    "## 关键点",
    paragraph,
    "## 背景",
    paragraph,
    "## 参考来源",
    "- [来源](https://allowed.example/story)"
  ].join("\n");
  assert.equal(assessGeneratedArticle(templated).ok, false);
});

test("publication gate rejects generic blog scaffolding with obvious AI voice", () => {
  const source = "https://allowed.example/report";
  const paragraph = "公告列出了实施主体、具体时间、适用范围和审核流程，正文据此解释执行条件，并把机构主张与编辑判断清楚分开。".repeat(8);
  const article = [
    "# 一项安排带来的变化",
    "",
    `据[官方公告](${source})，相关安排已经公布。${paragraph}`,
    "",
    "## 为什么这件事值得看",
    "",
    `真正重要的是，这项安排可能带来更广泛的影响。${paragraph}`,
    "",
    "## 企业落地方式",
    "",
    `更稳妥的做法是从低风险环节开始。${paragraph}`,
    "",
    "## 仍需观察的问题",
    "",
    paragraph,
    "",
    "## 参考来源",
    `- [官方公告](${source})`
  ].join("\n");

  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [source],
    requireInlineCitation: true
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /人机味|泛化博客小标题/);
});

test("publication gate rejects dense mechanical editorial phrases", () => {
  const source = "https://allowed.example/report";
  const paragraph = "公告给出了明确的时间、范围、责任主体和执行条件，足以支撑对流程变化的具体说明。".repeat(8);
  const article = [
    "# 公开安排明确了新的执行条件",
    "",
    `据[官方公告](${source})，安排已经公布。值得注意的是，${paragraph}`,
    "",
    "## 执行条件已经写明",
    "",
    `需要指出的是，${paragraph}真正重要的是，相关条件均可在公告中核对。`,
    "",
    "## 责任边界仍然清楚",
    "",
    `更稳妥的做法是按公告执行。${paragraph}`,
    "",
    "## 参考来源",
    `- [官方公告](${source})`
  ].join("\n");

  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [source],
    requireInlineCitation: true,
    minimumBodyInformationChars: 180
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /机械连接词|人机味/);
});

test("publication gate tolerates an allowed supplementary reference not linked inline", () => {
  const used = "https://allowed.example/used";
  const unused = "https://allowed.example/unused";
  const paragraph = "正文围绕一个具体事实展开，并补充必要的执行条件、适用范围和责任边界。".repeat(8);
  const article = [
    "# 标题",
    "",
    `据[已使用来源](${used})，安排已经公布。${paragraph}`,
    "",
    "## 具体执行边界",
    paragraph,
    "",
    "## 参考来源",
    `- [已使用来源](${used})`,
    `- [未使用来源](${unused})`
  ].join("\n");
  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [used, unused],
    requireInlineCitation: true
  });
  assert.equal(assessment.ok, true);
});

test("normalizes harmless model formatting drift in the final reference list", () => {
  const source = "https://allowed.example/report";
  const paragraph = "公告给出了明确主体、执行范围和责任边界，正文据此解释流程变化，并区分来源主张与作者判断。".repeat(10);
  const draft = [
    "```markdown",
    "# 公告明确了流程边界",
    "",
    `据[官方公告](${source})，相关安排已经公布。${paragraph}`,
    "",
    "## 执行条件",
    paragraph,
    "",
    "## 参考来源",
    `- [官方公告](${source})：2026 年 7 月发布，正文见链接`,
    `- [重复公告](${source}) — duplicate`,
    "```"
  ].join("\n");

  const normalized = normalizeGeneratedArticleMarkdown(draft);
  assert.doesNotMatch(normalized, /^```/);
  assert.match(normalized, new RegExp(`- \\[官方公告\\]\\(${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)$`, "m"));
  assert.equal((normalized.match(new RegExp(source, "g")) || []).length, 2);
  assert.equal(assessGeneratedArticle(normalized, {
    allowedSourceUrls: [source],
    requireInlineCitation: true
  }).ok, true);
});

test("publication gate requires references to be the final link-only section", () => {
  const source = "https://allowed.example/report";
  const paragraph = "公告给出了明确主体、执行时间、适用范围和责任边界，正文据此解释流程变化并保持准确归因。".repeat(10);
  const article = [
    "# 公开安排明确了执行条件",
    "",
    `据[官方公告](${source})，安排已经公布。${paragraph}`,
    "",
    "## 执行条件",
    "",
    paragraph,
    "",
    "## 参考来源",
    "",
    `- [官方公告](${source})`,
    "",
    "## 写在最后",
    "",
    paragraph
  ].join("\n");

  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [source],
    requireInlineCitation: true
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /必须置于文末|无链接条目/);
});

test("reference list rejects prose even when every line contains an allowed URL", () => {
  const first = "https://allowed.example/first";
  const second = "https://allowed.example/second";
  const paragraph = "正文围绕公开安排解释适用范围、责任主体和执行边界，并保持来源主张与编辑判断的区别。".repeat(10);
  const article = [
    "# 参考来源后不能夹带正文",
    "",
    `据[来源一](${first})和[来源二](${second})，安排已经公布。${paragraph}`,
    "",
    "## 执行边界",
    paragraph,
    "",
    "## 参考来源",
    `- [来源一](${first})`,
    `写在最后：这仍然是正文，只是夹带了[来源二](${second})。`
  ].join("\n");
  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [first, second],
    requireInlineCitation: true
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /Markdown 列表|不能追加正文/);
});

test("comments code and images do not count as visible citations", () => {
  const source = "https://allowed.example/hidden";
  const paragraph = "正文说明一项安排的适用范围、责任主体和执行边界，但读者看不到任何来源链接。".repeat(12);
  const article = [
    "# 隐藏 URL 不是引用",
    "",
    `${paragraph}\n<!-- ${source} -->\n\`ref=${source}\`\n\`\`\`text\n${source}\n\`\`\`\n![示意图](${source})`,
    "",
    "## 具体边界",
    paragraph,
    "",
    "## 参考来源",
    `- [隐藏来源](${source})`
  ].join("\n");
  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [source],
    requireInlineCitation: true
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /就近来源链接/);
});

test("URLs hidden in raw HTML attributes do not count as inline citations", () => {
  const source = "https://allowed.example/report";
  const filler = "正文解释市场结构、观察口径和判断边界，并保持事实与观点的区别。".repeat(10);
  const article = [
    "# 隐藏属性不能伪装成引用",
    "",
    filler,
    "",
    "## 市场数据",
    "",
    `KOSPI 升至 4000 点，外资净流出 70.8 万亿韩元。<span data-source="${source}"></span>`,
    "",
    "## 参考来源",
    `- [来源](${source})`
  ].join("\n");
  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [source],
    requireInlineCitation: true,
    minimumBodyInformationChars: 180
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /没有就近来源链接|精确事实/);
});

test("Markdown-looking HTML attributes and hidden anchors do not count as citations", () => {
  const source = "https://allowed.example/report";
  const filler = "正文解释市场结构、观察口径和判断边界，并保持事实与观点的区别。".repeat(10);
  for (const hidden of [
    `<span data-source="[来源](${source})"></span>`,
    `<a href="${source}" hidden></a>`,
    `<span title="> [来源](${source})"></span>`,
    `<span title="> <${source}>"></span>`
  ]) {
    const article = [
      "# 隐藏 HTML 不能伪装成引用",
      "",
      filler,
      "",
      "## 市场数据",
      "",
      `KOSPI 升至 4000 点，外资净流出 70.8 万亿韩元。${hidden}`,
      "",
      "## 参考来源",
      `- [来源](${source})`
    ].join("\n");
    const assessment = assessGeneratedArticle(article, {
      allowedSourceUrls: [source],
      requireInlineCitation: true,
      minimumBodyInformationChars: 180
    });
    assert.equal(assessment.ok, false);
    if (!assessment.ok) assert.match(assessment.reason, /没有就近来源链接|精确事实/);
  }
});

test("empty and image-only Markdown links do not count as visible citations", () => {
  const source = "https://allowed.example/report";
  const image = "https://images.example/chart.png";
  const filler = "正文解释市场结构、观察口径和判断边界，并保持事实与观点的区别。".repeat(10);
  for (const hidden of [
    `[](${source})`,
    `[ ](${source})`,
    `[&ZeroWidthSpace;](${source})`,
    `[![图](${image})](${source})`,
    `[<span hidden>来源</span>](${source})`,
    `[<span aria-hidden="true">来源</span>](${source})`,
    `[<span style="display:none">来源</span>](${source})`
  ]) {
    const article = [
      "# 不可辨识链接不是引用",
      "",
      filler,
      "",
      "## 市场数据",
      "",
      `KOSPI 升至 4000 点，外资净流出 70.8 万亿韩元。${hidden}`,
      "",
      "## 参考来源",
      `- [来源](${source})`
    ].join("\n");
    const assessment = assessGeneratedArticle(article, {
      allowedSourceUrls: [source],
      requireInlineCitation: true,
      minimumBodyInformationChars: 180
    });
    assert.equal(assessment.ok, false, hidden);
    if (!assessment.ok) assert.match(assessment.reason, /没有就近来源链接|精确事实/);
  }
});

test("raw HTML anchors are audited even though they do not count as citations", () => {
  const first = "https://allowed.example/one";
  const second = "https://allowed.example/two";
  const filler = "正文围绕可核验资料解释事实边界、现实影响和仍需观察的条件。".repeat(10);
  const article = [
    "# 原始 HTML 外链也必须属于资料白名单",
    "",
    `据[来源一](${first})，相关事实已经公开。${filler}`,
    "",
    `另据[来源二](${second})，研究口径已经说明。${filler}`,
    "",
    "## 补充链接",
    "",
    `<a href="https://evil.example/phish">恶意外链</a>`,
    "",
    "## 参考来源",
    `- [来源一](${first})`,
    `- [来源二](${second})`
  ].join("\n");
  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [first, second],
    requireInlineCitation: true,
    minimumDistinctInlineSources: 2
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /资料之外的链接/);
});

test("indented code and unused link definitions do not count as nearby citations", () => {
  const source = "https://allowed.example/report";
  const filler = "正文解释市场结构、观察口径和判断边界，并保持事实与观点的区别。".repeat(10);
  for (const hidden of [`    ${source}`, `[hidden-source]: ${source}`]) {
    const article = [
      "# 不可见定义不能伪装成引用",
      "",
      filler,
      "",
      "## 市场数据",
      "",
      hidden,
      "",
      "KOSPI 升至 4000 点，外资净流出 70.8 万亿韩元。",
      "",
      "## 参考来源",
      `- [来源](${source})`
    ].join("\n");
    const assessment = assessGeneratedArticle(article, {
      allowedSourceUrls: [source],
      requireInlineCitation: true,
      minimumBodyInformationChars: 180
    });
    assert.equal(assessment.ok, false);
    if (!assessment.ok) assert.match(assessment.reason, /没有就近来源链接|精确事实/);
  }
});

test("precision facts need a citation in the same or preceding paragraph", () => {
  const source = "https://allowed.example/report";
  const context = "文章先解释制度背景、适用对象和责任边界，不包含精确数字或可归属引语。".repeat(8);
  const article = [
    "# 精确事实必须就近引用",
    "",
    `据[官方公告](${source})，相关制度已经公布。${context}`,
    "",
    "## 执行变化",
    "",
    context,
    "",
    "另一家公司宣布明年裁员百分之五十，并确认该决定将在下周开始执行。",
    "",
    "## 参考来源",
    `- [官方公告](${source})`
  ].join("\n");
  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [source],
    requireInlineCitation: true
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /精确事实.*就近来源/);
});

test("opinion and transition paragraphs do not each require a citation", () => {
  const source = "https://allowed.example/opinion";
  const paragraph = "这一安排的价值取决于执行透明度。对读者而言，更重要的是观察责任是否清楚，而不是预先断言结果。".repeat(10);
  const article = [
    "# 一篇保持事实边界的短评",
    "",
    `据[原始公告](${source})，相关安排已经公布。${paragraph}`,
    "",
    "## 判断的边界",
    "",
    paragraph,
    "",
    "## 参考来源",
    `- [原始公告](${source})`
  ].join("\n");
  assert.equal(assessGeneratedArticle(article, {
    allowedSourceUrls: [source],
    requireInlineCitation: true
  }).ok, true);
});

test("relative dates in ordinary opinions are not treated as precise events", () => {
  const source = "https://allowed.example/opinion-date";
  const filler = "这类判断关注长期边界和读者风险承受能力，不把尚未发生的结果表述为确定事实。".repeat(9);
  const article = [
    "# 保持时间观点的事实边界",
    "",
    `据[原始资料](${source})，讨论背景已经公开。${filler}`,
    "",
    "## 编辑判断",
    "",
    `今年，企业更需要支持长期研发，而不是追逐短期热度。本周的讨论更适用于风险偏好较高的读者。${filler}`,
    "",
    "## 参考来源",
    `- [原始资料](${source})`
  ].join("\n");
  assert.equal(assessGeneratedArticle(article, {
    allowedSourceUrls: [source],
    requireInlineCitation: true
  }).ok, true);
});

test("analysis restating already-cited figures within a section is publishable", () => {
  // 真实回归：模型生成的分析段复述本小节已引用来源里的数字，并显式标注
  // 这些数字是“发布会报道中的直接信息”。它不是凭空捏造，应放行，不能整篇打回。
  const source1 = "https://allowed.example/waic";
  const source2 = "https://allowed.example/ndrc";
  const filler = "文章据此说明产业结构如何随政策和需求变化，并交代判断适用的行业边界与时间口径。".repeat(4);
  const article = [
    "# 人工智能产业增速观察",
    "",
    `据[发布会通报](${source1})，2025 年相关产业规模突破万亿元，今年增速预计在 30% 以上。${filler}`,
    "",
    "## 增长来自哪里",
    "",
    `另据[发改委说明](${source2})，重点行业整体渗透率突破 80%。${filler}`,
    "",
    "这里需要区分事实和判断。30% 以上增速、万亿元规模，是发布会报道中的直接信息；增长越来越依赖场景组织，则是基于这些事实作出的判断。" + filler,
    "",
    "## 参考来源",
    `- [发布会通报](${source1})`,
    `- [发改委说明](${source2})`
  ].join("\n");
  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [source1, source2],
    requireInlineCitation: true,
    minimumDistinctInlineSources: 2
  });
  assert.equal(assessment.ok, true, assessment.ok ? "" : assessment.reason);
});

test("a well-cited article is not rejected over one quote paragraph's link placement", () => {
  // 真实回归（第三次线上打回）：成稿正文已经用了 2 个独立白名单来源，其中一段
  // 忠实转引来源里的原话并在行文中明确归因，但该段本身没有再放链接。
  // 已达来源配额的成稿不能因单段链接位置整篇报废。
  const source1 = "https://allowed.example/tsinghua";
  const source2 = "https://allowed.example/ndrc";
  const filler = "文章交代判断的适用范围、时间口径与责任主体，说明结论在什么条件下成立。".repeat(5);
  const article = [
    "# 智能体时代的竞争边界",
    "",
    `据[清华大学前瞻](${source1})，行业结构正在发生变化。${filler}`,
    "",
    "## 共识与分歧",
    "",
    `另据[发改委通报](${source2})，产业渗透率持续上升。${filler}`,
    "",
    `清华大学官网刊发的前瞻文章称，行业专家形成共识：“以对话为核心的范式已告终结”。${filler}`,
    "",
    "## 参考来源",
    `- [清华大学前瞻](${source1})`,
    `- [发改委通报](${source2})`
  ].join("\n");
  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [source1, source2],
    requireInlineCitation: true,
    minimumDistinctInlineSources: 2
  });
  assert.equal(assessment.ok, true, assessment.ok ? "" : assessment.reason);
});

test("a brand-new uncited precise fact in a later section is still rejected", () => {
  // 反向保护：来源稀疏（单来源）成稿仍走严格就近引用检查。全新小节里出现
  // 从未建立来源、也没有转述标注的精确事实 + 动作，仍须打回。
  const source = "https://allowed.example/base";
  const filler = "文章解释制度背景、适用对象和执行边界，不含新的精确数字或可归属引语。".repeat(6);
  const article = [
    "# 引用记忆不跨小节泄漏",
    "",
    `据[官方公告](${source})，相关制度已经公布。${filler}`,
    "",
    "## 全新小节",
    "",
    filler,
    "",
    "某公司宣布明年将投资 120 亿元新建三家工厂，并确认相关计划下月开始执行。",
    "",
    "## 参考来源",
    `- [官方公告](${source})`
  ].join("\n");
  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [source],
    requireInlineCitation: true
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /精确事实.*就近来源/);
});

test("two earlier sources do not authorize an uncited fabricated forecast in a new section", () => {
  const source1 = "https://allowed.example/one";
  const source2 = "https://allowed.example/two";
  const filler = "正文解释已公开安排的适用对象、执行条件和判断边界，不在这里增加新的数字。".repeat(7);
  const article = [
    "# 两条来源不能成为全文通行证",
    "",
    `据[来源一](${source1})，第一项安排已经公开。${filler}`,
    "",
    "## 第二项安排",
    "",
    `据[来源二](${source2})，第二项安排已经公开。${filler}`,
    "",
    "## 无来源预测",
    "",
    "某机构确认 2026 年下半年外资将净流出 708 亿美元，并预计指数会在 9 月下跌 25%。",
    "",
    "## 参考来源",
    `- [来源一](${source1})`,
    `- [来源二](${source2})`
  ].join("\n");
  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [source1, source2],
    requireInlineCitation: true,
    minimumDistinctInlineSources: 2
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /精确事实.*就近来源/);
});

test("a reported dollar outflow cannot bypass the precision gate without a nearby link", () => {
  const source1 = "https://allowed.example/korea-one";
  const source2 = "https://allowed.example/korea-two";
  const filler = "正文只解释韩国股市的结构、估值方法和观察边界，不在这里增加任何精确数字。".repeat(7);
  const article = [
    "# 韩国股市下半年观察",
    "",
    `据[来源一](${source1})，市场结构正在变化。${filler}`,
    "",
    `另据[来源二](${source2})，投资者正在重新评估风险。${filler}`,
    "",
    "## 外资流向",
    "",
    filler,
    "",
    "据《朝鲜日报》报道，2026 年上半年外资净撤出金额高达 708 亿美元，尽管 KOSPI 指数持续攀升。",
    "",
    "## 参考来源",
    `- [来源一](${source1})`,
    `- [来源二](${source2})`
  ].join("\n");
  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [source1, source2],
    requireInlineCitation: true,
    minimumDistinctInlineSources: 2
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /精确事实.*就近来源/);
});

test("Korean market points won flows and valuation multiples require a nearby link", () => {
  const source1 = "https://allowed.example/kospi-one";
  const source2 = "https://allowed.example/kospi-two";
  const filler = "正文说明指数观察方法与风险边界，不在这里陈述新的市场数字。".repeat(9);
  const article = [
    "# 韩国股市风险观察",
    "",
    `据[来源一](${source1})，交易结构出现变化。${filler}`,
    "",
    `另据[来源二](${source2})，投资者继续评估市场风险。${filler}`,
    "",
    "## 未获支持的市场数字",
    "",
    filler,
    "",
    "KOSPI 升至 4000 点，外资净流出 70.8 万亿韩元，市场整体市盈率达到 35 倍。",
    "",
    "## 参考来源",
    `- [来源一](${source1})`,
    `- [来源二](${source2})`
  ].join("\n");
  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [source1, source2],
    requireInlineCitation: true,
    minimumDistinctInlineSources: 2
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /精确事实.*就近来源/);
});

test("uncited corporate and government actions are rejected even without numbers", () => {
  const source1 = "https://allowed.example/company-one";
  const source2 = "https://allowed.example/company-two";
  const filler = "正文讨论产业结构与判断边界，不在这里加入新的公司交易或政策事实。".repeat(9);
  const article = [
    "# 企业交易需要真实来源",
    "",
    `据[来源一](${source1})，行业竞争格局正在变化。${filler}`,
    "",
    `另据[来源二](${source2})，市场参与者继续观察。${filler}`,
    "",
    "## 未获支持的重大动作",
    "",
    filler,
    "",
    "三星宣布收购 SK 海力士，并计划关闭全部海外工厂。韩国财政部长已经批准交易。",
    "",
    "## 参考来源",
    `- [来源一](${source1})`,
    `- [来源二](${source2})`
  ].join("\n");
  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [source1, source2],
    requireInlineCitation: true,
    minimumDistinctInlineSources: 2
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /精确事实.*就近来源/);
});

test("later uncertainty or restatement framing cannot excuse a separate invented action", () => {
  const source1 = "https://allowed.example/company-one";
  const source2 = "https://allowed.example/company-two";
  const filler = "正文讨论产业结构与判断边界，不在这里加入新的公司交易或政策事实。".repeat(9);
  for (const claim of [
    "三星宣布收购 SK 海力士，并计划关闭全部海外工厂。这项交易可能改变竞争格局。",
    "三星已经收购 SK 海力士，并关闭全部海外工厂。",
    "韩国政府通过新法案并否决企业申请。",
    "上述数据来自前文来源。三星宣布收购 SK 海力士，并关闭全部海外工厂。",
    "这些数据是发布会报道中的直接信息；另一机构确认 2026 年将投资 900 亿元。",
    "上述数据来自前文来源，三星宣布收购 SK 海力士并关闭全部海外工厂。",
    "这些数据是发布会报道中的直接信息，另一机构确认 2026 年将投资 900 亿元。",
    "如果三星收购另一家公司，韩国政府已经批准交易。",
    "如果三星收购 SK 海力士而韩国政府已经批准交易并关闭全部工厂。",
    "三星可能收购另一家公司但韩国政府已经批准交易。",
    "上述数据来自前文来源且三星宣布收购 SK 海力士并关闭全部海外工厂。",
    "这些数据属于前述来源而另一机构确认 2026 年投资 900 亿元。"
  ]) {
    const article = [
      "# 重大动作需要真实来源",
      "",
      `据[来源一](${source1})，行业竞争格局正在变化。${filler}`,
      "",
      `另据[来源二](${source2})，市场参与者继续观察。${filler}`,
      "",
      "## 未获支持的动作",
      "",
      claim,
      "",
      "## 参考来源",
      `- [来源一](${source1})`,
      `- [来源二](${source2})`
    ].join("\n");
    const assessment = assessGeneratedArticle(article, {
      allowedSourceUrls: [source1, source2],
      requireInlineCitation: true,
      minimumDistinctInlineSources: 2
    });
    assert.equal(assessment.ok, false, claim);
    if (!assessment.ok) assert.match(assessment.reason, /精确事实.*就近来源/);
  }
});

test("a cited list item does not authorize uncited facts in sibling items", () => {
  const source = "https://allowed.example/list";
  const filler = "正文说明行业结构、讨论边界与核验方法，不在这里加入新的公司或政策事实。".repeat(10);
  const article = [
    "# 每个列表事实都要有自己的依据",
    "",
    `据[背景资料](${source})，行业情况已经公开。${filler}`,
    "",
    "## 逐项观察",
    "",
    `- [已核验事项](${source})`,
    "- 三星已经收购 SK 海力士并关闭全部海外工厂。",
    "- 韩国政府通过新法案并否决企业申请。",
    "",
    "## 参考来源",
    `- [背景资料](${source})`
  ].join("\n");
  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [source],
    requireInlineCitation: true
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /精确事实.*就近来源/);
});

test("rhetorical quoted labels are not mistaken for uncited precise facts", () => {
  const source = "https://allowed.example/edge-ai";
  const context = "文章解释成本如何在设备采购、维护、能耗和云服务之间转移，并限定判断适用的产品生命周期。".repeat(8);
  const article = [
    "# 本地推理没有消灭成本",
    "",
    `据[产品说明](${source})，端侧方案改变了计算发生的位置。${context}`,
    "",
    "## 成本只是换了位置",
    "",
    context,
    "",
    "“本地推理等于零成本”是容易造成误解的简化说法，真实取舍取决于设备与服务边界。",
    "",
    "## 参考来源",
    `- [产品说明](${source})`
  ].join("\n");
  assert.equal(assessGeneratedArticle(article, {
    allowedSourceUrls: [source],
    requireInlineCitation: true
  }).ok, true);
});

test("publication gate scans the full article for leaked model process", () => {
  const source = "https://allowed.example/report";
  const paragraph = "公告列出了实施主体、具体日期、适用范围和审核流程，文章据此解释执行条件与责任边界。".repeat(10);
  const article = [
    "# 公告列明了审核流程",
    "",
    `据[官方公告](${source})，安排已经公布。${paragraph}`,
    "",
    "## 审核流程",
    "",
    paragraph,
    "",
    `我需要先分析这些材料。${paragraph}`,
    "",
    "## 参考来源",
    "",
    `- [官方公告](${source})`
  ].join("\n");

  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [source],
    requireInlineCitation: true
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /模型任务|写作过程/);
});

test("publication gate recognizes Markdown autolinks as inline citations", () => {
  const source = "https://allowed.example/autolink";
  const paragraph = "正文围绕已公布的执行安排展开，并说明适用范围、责任主体和现实边界。".repeat(10);
  const article = [
    "# Autolink 也属于来源链接",
    "",
    `原始公告见 <${source}>。${paragraph}`,
    "",
    "## 执行范围",
    paragraph,
    "",
    "## 参考来源",
    `- <${source}>`
  ].join("\n");

  assert.equal(assessGeneratedArticle(article, {
    allowedSourceUrls: [source],
    requireInlineCitation: true
  }).ok, true);
});

test("publication gate rejects a bare body URL missing from references", () => {
  const listed = "https://allowed.example/listed";
  const unlisted = "https://allowed.example/unlisted";
  const paragraph = "正文给出了明确事实、执行条件与适用范围，并对来源主张保持了准确归因。".repeat(10);
  const article = [
    "# 裸 URL 也必须列入参考来源",
    "",
    `据[已列来源](${listed})，安排已经公布；补充材料见 ${unlisted}。${paragraph}`,
    "",
    "## 具体边界",
    paragraph,
    "",
    "## 参考来源",
    `- [已列来源](${listed})`
  ].join("\n");
  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [listed, unlisted],
    requireInlineCitation: true
  });

  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /正文来源未列入参考来源/);
});

test("publication gate rejects a bare URL outside the source allowlist", () => {
  const allowed = "https://allowed.example/story";
  const invented = "https://invented.example/story";
  const paragraph = "文章围绕一个可核验事实展开，并补充必要的时间、范围和责任边界。".repeat(10);
  const article = [
    "# 裸 URL 不能绕过来源白名单",
    "",
    `据[允许来源](${allowed})，相关安排已经公布。${paragraph}`,
    "",
    "## 具体变化",
    `更多信息被指向 ${invented}。${paragraph}`,
    "",
    "## 参考来源",
    `- [允许来源](${allowed})`,
    `- ${invented}`
  ].join("\n");
  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [allowed],
    requireInlineCitation: true
  });

  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /资料之外的链接/);
});

test("short opinion may omit H2 without weakening source and citation checks", () => {
  const source = "https://example.com/opinion-source";
  const paragraph = "这是一篇紧凑短评，围绕一个判断展开，并清楚区分来源事实、来源主张和编辑推论。".repeat(12);
  const article = [
    "# 一个克制的短评标题",
    "",
    `据[原始来源](${source})，相关安排已经公布。${paragraph}`,
    "",
    "## 参考来源",
    `- [原始来源](${source})`
  ].join("\n");
  assert.equal(assessGeneratedArticle(article, {
    allowedSourceUrls: [source],
    requireInlineCitation: true,
    requireSectionHeadings: false
  }).ok, true);
});

test("short article uses a shorter body floor without weakening citation checks", () => {
  const source = "https://example.com/short-source";
  const paragraph = "公开说明给出了安排的适用对象和责任边界。短文据此提出一个克制判断，并明确哪些结果仍不能预先断言。".repeat(5);
  const article = [
    "# 一篇紧凑但完整的文章",
    "",
    `据[公开说明](${source})，安排已经发布。${paragraph}`,
    "",
    "## 参考来源",
    `- [公开说明](${source})`
  ].join("\n");

  assert.equal(assessGeneratedArticle(article, {
    allowedSourceUrls: [source],
    requireInlineCitation: true,
    requireSectionHeadings: false
  }).ok, false);
  assert.equal(assessGeneratedArticle(article, {
    allowedSourceUrls: [source],
    requireInlineCitation: true,
    requireSectionHeadings: false,
    minimumBodyInformationChars: 180
  }).ok, true);
});

test("publication gate requires real source diversity for multi-source tasks", () => {
  const source = "https://example.com/only-source";
  const other = "https://example.com/unused-source";
  const paragraph = "公告给出了明确主体、执行时间、适用范围和责任边界，正文只据此解释已经能够核实的变化。".repeat(10);
  const article = [
    "# 一项安排改变了具体执行流程",
    "",
    `据[官方公告](${source})，新流程已经公布。${paragraph}`,
    "",
    "## 执行边界",
    paragraph,
    "",
    "## 参考来源",
    `- [官方公告](${source})`
  ].join("\n");

  const assessment = assessGeneratedArticle(article, {
    allowedSourceUrls: [source, other],
    requireInlineCitation: true,
    minimumDistinctInlineSources: 2
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /至少需要 2 个/);
});

test("publication gate rejects clickbait titles and generic throat-clearing leads", () => {
  const source = "https://example.com/report";
  const paragraph = "材料列出了可核验的主体、动作、时间和适用条件，文章据此解释实际变化。".repeat(10);
  const clickbait = [
    "# 重磅：一文读懂全部变化",
    "",
    `据[来源](${source})，安排已经公布。${paragraph}`,
    "",
    "## 执行条件",
    paragraph,
    "",
    "## 参考来源",
    `- [来源](${source})`
  ].join("\n");
  assert.equal(assessGeneratedArticle(clickbait).ok, false);

  const genericLead = clickbait.replace("# 重磅：一文读懂全部变化", "# 新安排的执行边界")
    .replace(`据[来源](${source})，安排已经公布。`, "随着技术不断发展，越来越多变化正在发生。");
  const assessment = assessGeneratedArticle(genericLead);
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /导语/);
});

test("publication gate rejects outline-like over-sectioning", () => {
  const source = "https://example.com/report";
  // 提纲式：小节数量多且平均信息量低。导语先给足正文信息量，避免先触发字数门槛。
  const lead = "据[来源](${src})，安排已经公布。这一部分继续提供新的事实、适用条件和必要限定，不重复前文，也不补写来源之外的信息，确保导语本身就承载了足够的具体信息量。".replace("${src}", source).repeat(5);
  const stub = "该切面只有一句概述，没有展开事实。";
  const article = [
    "# 新安排的八个执行切面",
    "",
    lead,
    "",
    ...Array.from({ length: 8 }, (_, index) => `## 切面 ${index + 1}\n\n${stub}`),
    "",
    "## 参考来源",
    `- [来源](${source})`
  ].join("\n");
  const assessment = assessGeneratedArticle(article);
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /结构过碎/);
});

test("a weekly roundup with seven substantial sections is not over-sectioned", () => {
  const source = "https://example.com/report";
  const paragraph = "这一部分继续提供新的事实、适用条件和必要限定，不重复前文，也不补写来源之外的信息。".repeat(8);
  const article = [
    "# 本周进展综述",
    "",
    `据[来源](${source})，安排已经公布。${paragraph}`,
    "",
    ...Array.from({ length: 7 }, (_, index) => `## 主题 ${index + 1}\n\n${paragraph}`),
    "",
    "## 参考来源",
    `- [来源](${source})`
  ].join("\n");
  const assessment = assessGeneratedArticle(article);
  assert.equal(assessment.ok, true);
});

test("unpublishable output has its own error type and is not a bad source", () => {
  assert.throws(
    () => assertPublishableGeneratedArticle("INSUFFICIENT_EVIDENCE: 只有标题"),
    UnpublishableGeneratedArticleError
  );
});

test("precision facts and major actions in headings still require a nearby source", () => {
  const source = "https://allowed.example/korea";
  const filler = "正文解释市场结构、判断边界和仍需观察的条件，不在这里增加新的公司动作或精确数字。".repeat(9);
  for (const article of [
    [
      "# 三星已经收购 SK 海力士",
      "",
      filler,
      "",
      `据[核验来源](${source})，行业竞争格局正在变化。`,
      "",
      "## 观察边界",
      filler,
      "",
      "## 参考来源",
      `- [核验来源](${source})`
    ].join("\n"),
    [
      "# 韩国股市观察",
      "",
      `据[核验来源](${source})，市场结构正在变化。${filler}`,
      "",
      "## 外资净撤出 708 亿美元",
      "",
      filler,
      "",
      "## 参考来源",
      `- [核验来源](${source})`
    ].join("\n")
  ]) {
    const assessment = assessGeneratedArticle(article, {
      allowedSourceUrls: [source],
      requireInlineCitation: true,
      minimumBodyInformationChars: 180
    });
    assert.equal(assessment.ok, false);
    if (!assessment.ok) assert.match(assessment.reason, /精确事实.*就近来源/);
  }
});

test("a sourced first paragraph may substantiate the factual heading immediately above it", () => {
  const source = "https://allowed.example/korea";
  const filler = "正文解释核验口径、影响范围和判断边界，并且不增加来源之外的新事实。".repeat(10);
  const article = [
    "# 韩国股市观察",
    "",
    `据[核验来源](${source})，市场结构正在变化。${filler}`,
    "",
    "## KOSPI 升至 4000 点",
    "",
    `据[核验来源](${source})，KOSPI 升至 4000 点。${filler}`,
    "",
    "## 参考来源",
    `- [核验来源](${source})`
  ].join("\n");
  assert.equal(assessGeneratedArticle(article, {
    allowedSourceUrls: [source],
    requireInlineCitation: true,
    minimumBodyInformationChars: 180
  }).ok, true);
});

test("rendered links reject protocol-relative FTP and script schemes", () => {
  const source = "https://allowed.example/report";
  const filler = "正文说明公开安排的执行边界、适用对象和判断条件，不增加未经核验的事实。".repeat(10);
  for (const unsafeLink of [
    "[可疑链接](//evil.example/path)",
    "[可疑链接](ftp://evil.example/path)",
    '<a href="javascript:alert(1)">可疑链接</a>'
  ]) {
    const article = [
      "# 公开安排的执行边界",
      "",
      `据[核验来源](${source})，相关安排已经公布。${filler}`,
      "",
      "## 补充说明",
      `${unsafeLink}${filler}`,
      "",
      "## 参考来源",
      `- [核验来源](${source})`
    ].join("\n");
    const assessment = assessGeneratedArticle(article, {
      allowedSourceUrls: [source],
      requireInlineCitation: true
    });
    assert.equal(assessment.ok, false, unsafeLink);
    if (!assessment.ok) assert.match(assessment.reason, /不安全|链接协议/);
  }
});

test("only exact local image-tool figures are exempt during administrator re-review", () => {
  const source = "https://allowed.example/report";
  const imageSource = "https://images.example/photo-page";
  const filler = "正文说明公开安排的执行边界、适用对象和判断条件，不增加未经核验的事实。".repeat(10);
  const figure = `<figure class="article-media article-image"><img src="/uploads/image/2026/07/photo.webp" alt="资料图" loading="lazy" decoding="async"><figcaption><span>资料图</span><a href="${imageSource}" target="_blank" rel="noreferrer">图片来源</a></figcaption></figure>`;
  const article = [
    "# 公开安排的执行边界",
    "",
    `据[核验来源](${source})，相关安排已经公布。${filler}`,
    "",
    figure,
    "",
    "## 具体条件",
    filler,
    "",
    "## 参考来源",
    `- [核验来源](${source})`
  ].join("\n");
  const options = { allowedSourceUrls: [source], requireInlineCitation: true };
  assert.equal(assessGeneratedArticle(article, options).ok, false);
  assert.equal(assessGeneratedArticle(article, {
    ...options,
    allowTrustedLocalMediaFigures: true
  }).ok, true);

  const tampered = article.replace('decoding="async"', 'decoding="async" onerror="alert(1)"');
  assert.equal(assessGeneratedArticle(tampered, {
    ...options,
    allowTrustedLocalMediaFigures: true
  }).ok, false);
});
