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
import { evidenceFromExaResult } from "../src/worker/evidence";

function factualSourceText(subject: string, count = 18) {
  return Array.from({ length: count }, (_, index) =>
    `2026年7月${(index % 20) + 1}日，${subject}确认第${index + 1}项安排开始实施，涉及${index + 2}个执行环节，并公布对应责任主体。`
  ).join("\n");
}

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

test("long search excerpts do not substitute for fetched full text", () => {
  const text = "这是一条较长搜索摘要，包含主体、日期、动作和若干背景信息，但并不是已抓取的完整正文。".repeat(20);
  const excerptOnly = assessEvidenceSufficiency([
    { title: "来源一", url: "https://one.example/a", summary: text, materialKind: "excerpt" },
    { title: "来源二", url: "https://two.example/b", summary: text, materialKind: "excerpt" }
  ], { minFullTextItems: 1 });
  assert.equal(excerptOnly.ok, false);
  if (!excerptOnly.ok) assert.match(excerptOnly.reason, /正文级资料/);
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
    requireInlineCitation: true
  });
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /机械连接词|人机味/);
});

test("publication gate rejects a reference that the body never uses", () => {
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
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /未在正文实际使用/);
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

test("unpublishable output has its own error type and is not a bad source", () => {
  assert.throws(
    () => assertPublishableGeneratedArticle("INSUFFICIENT_EVIDENCE: 只有标题"),
    UnpublishableGeneratedArticleError
  );
});
