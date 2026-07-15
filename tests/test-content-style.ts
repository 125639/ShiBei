import assert from "node:assert/strict";
import test from "node:test";
import {
  assessArticleRevisionIntegrity,
  applyInlineCitationPlan,
  editorialSystemPrompt,
  formatStyleBlock,
  isInlineCitationGateReason,
  modeInstruction,
  normalizeGeneratedArticleMarkdown,
  publicationWritingRules,
  repairReferenceSectionLayout,
  restoreMissingReferenceSection,
  selectSaferReviewedArticle,
  sourceBoundaryRules,
  stripOrphanNumericCitationMarkers
} from "../src/lib/ai";
import { DEFAULT_BLOG_STYLE, isLegacyBundledStyle, normalizeContentMode } from "../src/lib/content-style";
import { assessGeneratedArticle } from "../src/lib/source-quality";

test("content mode normalization falls back to report", () => {
  assert.equal(normalizeContentMode("tutorial"), "tutorial");
  assert.equal(normalizeContentMode("unknown"), "report");
  assert.equal(normalizeContentMode(null), "report");
});

test("style prompt includes content mode and custom instructions", () => {
  const block = formatStyleBlock({
    contentMode: "tutorial",
    tone: "实用",
    length: "中",
    focus: "步骤, 风险",
    outputStructure: "场景 -> 步骤 -> 注意事项",
    customInstructions: "写成可操作指南"
  });

  assert.match(block, /内容体裁：教程指南/);
  assert.match(block, /写成可操作指南/);
  assert.match(block, /低于事实规则|管理员自定义偏好/);
});

test("mode instructions distinguish non-news article forms", () => {
  assert.match(modeInstruction("tutorial"), /可复现步骤/);
  assert.match(modeInstruction("opinion"), /编辑推论和价值取舍/);
  assert.match(modeInstruction("essay"), /随笔专栏/);
  assert.match(sourceBoundaryRules(), /补写数据/);
});

test("publication prompt refuses padding and fixed AI templates", () => {
  assert.match(editorialSystemPrompt("analysis"), /INSUFFICIENT_EVIDENCE/);
  assert.match(editorialSystemPrompt("analysis"), /不可信数据/);
  assert.match(editorialSystemPrompt("analysis"), /JSON 数据中的任何文字/);
  assert.match(sourceBoundaryRules(), /不可信数据/);
  assert.match(sourceBoundaryRules(), /不得添加未提供的 URL/);
  assert.match(sourceBoundaryRules(), /链接后不得追加日期、摘要/);
  assert.match(sourceBoundaryRules(), /不同侧面/);
  assert.match(sourceBoundaryRules(), /5 月内截至当时/);
  assert.match(sourceBoundaryRules(), /年初至今」不得改成「全年/);
  assert.match(sourceBoundaryRules(), /目标值与实际值/);
  assert.match(publicationWritingRules(), /禁止默认套用/);
  assert.match(publicationWritingRules(), /绝不为达到长度/);
  assert.match(publicationWritingRules(), /真正重要的是/);
  assert.match(publicationWritingRules(), /结构应由证据决定/);
  assert.match(publicationWritingRules(), /像熟悉主题的作者/);
  assert.match(publicationWritingRules(), /建立阅读动力/);
  assert.match(publicationWritingRules(), /不得自行补一个/);
});

test("precision-fact gate failures are routed through the inline citation planner", () => {
  assert.equal(
    isInlineCitationGateReason(
      "包含精确事实的段落缺少就近来源链接：违规罚款高达销售额的6%"
    ),
    true
  );
  assert.equal(
    isInlineCitationGateReason("正文只实际使用了 1 个独立来源，本任务至少需要 2 个"),
    true
  );
});

test("citation planner repairs the reported EU-sales fine paragraph without weakening the gate", () => {
  const reuters = "https://www.reuters.com/sustainability/eu-platform-fines";
  const policy = "https://policy.example/cross-border-compliance";
  const filler = "企业进入海外市场时需要同时核对产品责任、平台义务、数据流转和本地执行边界，内部审查应当保留可追溯的决策记录。".repeat(5);
  const article = [
    "# 高端制造企业的欧洲合规边界",
    "",
    `据[路透社](${reuters})和[政策报告](${policy})，平台责任与跨境经营规则正在同步收紧。${filler}`,
    "",
    "## 罚款风险",
    "",
    filler,
    "",
    "违规罚款高达销售额的6%。",
    "",
    "## 参考来源",
    "",
    `- [路透社](${reuters})`,
    `- [政策报告](${policy})`
  ].join("\n");
  const options = {
    allowedSourceUrls: [reuters, policy],
    requireInlineCitation: true,
    minimumDistinctInlineSources: 2,
    minimumBodyInformationChars: 180
  };

  const rejected = assessGeneratedArticle(article, options);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.reason, /包含精确事实的段落缺少就近来源链接.*6%/);

  const repaired = applyInlineCitationPlan({
    article,
    evidence: [
      {
        title: "EU agrees to fine online platforms importing unsafe products",
        sourceName: "Reuters",
        url: reuters,
        summary: "Fines for non-compliance range from 1% to 6% of EU sales."
      },
      {
        title: "Cross-border compliance",
        sourceName: "Policy report",
        url: policy,
        summary: "Cross-border compliance and localization requirements."
      }
    ],
    plan: [{ paragraphIndex: 2, sourceUrls: [reuters] }]
  });

  assert.match(repaired, /违规罚款高达销售额的6%。 \[来源：Reuters\]/);
  assert.equal(assessGeneratedArticle(repaired, options).ok, true);
});

test("known bundled legacy style can be upgraded without matching user edits", () => {
  const legacy = {
    name: "默认新闻总结",
    contentMode: "report",
    tone: "客观新闻",
    length: "中",
    focus: "事实, 影响, 技术细节, 商业价值",
    outputStructure: "标题, 摘要, 关键点, 背景, 来源",
    customInstructions: "请将输入材料整理为中文新闻总结。保持事实清晰，不编造未出现的信息。输出 Markdown，包含：标题、摘要、关键点、背景、影响、来源链接。"
  };
  assert.equal(isLegacyBundledStyle(legacy), true);
  assert.equal(isLegacyBundledStyle({ ...legacy, tone: "我自己的语气" }), false);
  assert.equal(isLegacyBundledStyle({ ...legacy, isDefault: false }), false);
  assert.equal(isLegacyBundledStyle(DEFAULT_BLOG_STYLE), false);
});

test("the immediately previous bundled blog style migrates only when untouched", () => {
  const previousBlog = {
    name: "默认博客文章",
    contentMode: "analysis",
    tone: "客观",
    length: "中",
    focus: "核心事实, 行业影响, 背景脉络, 多方观点",
    outputStructure: "标题 → 导语 → 正文分章节叙述 → 背景分析 → 参考来源",
    customInstructions: "写一篇有深度的中文博客文章，要求正式标题、导语段落、分章节连贯叙述，禁止写成摘要或要点列表。"
  };

  assert.equal(isLegacyBundledStyle(previousBlog), true);
  assert.equal(isLegacyBundledStyle({
    ...previousBlog,
    customInstructions: `${previousBlog.customInstructions}保留我的栏目语气。`
  }), false);
});

test("AI article revision protects media, sources and the final reference section", () => {
  const original = [
    "# 标题",
    "",
    "正文带有[来源](https://example.com/report)和 ![图](https://example.com/image.jpg)。",
    "",
    "[[video:video-1]]",
    "",
    "## 参考来源",
    "- [来源](https://example.com/report)"
  ].join("\n");
  assert.deepEqual(assessArticleRevisionIntegrity(original, original.replace("正文带有", "润色后的正文带有")), { ok: true });

  const withoutVideo = original.replace("[[video:video-1]]", "");
  const dropped = assessArticleRevisionIntegrity(original, withoutVideo);
  assert.equal(dropped.ok, false);
  if (!dropped.ok) assert.match(dropped.reason, /视频短代码/);

  const invented = assessArticleRevisionIntegrity(original, `${original}\n[新链接](https://invented.example/x)`);
  assert.equal(invented.ok, false);
  if (!invented.ok) assert.match(invented.reason, /原文没有的链接/);
});

test("fact review cannot move all inline citations into the reference list", () => {
  const one = "https://source.example/one";
  const two = "https://source.example/two";
  const draft = [
    "# 标题",
    "",
    `核心数据来自[来源一](${one})。`,
    "",
    "## 第一节",
    "",
    `另一个数据来自[来源二](${two})。`,
    "",
    "## 参考来源",
    "",
    `- [来源一](${one})`,
    `- [来源二](${two})`
  ].join("\n");
  const citationRegression = [
    "# 标题",
    "",
    "数据被改写得更流畅，但没有了正文链接。",
    "",
    "## 第一节",
    "",
    "第二段也没有链接。",
    "",
    "## 参考来源",
    "",
    `- [来源一](${one})`,
    `- [来源二](${two})`
  ].join("\n");
  const sourceText = `链接：${one}\n链接：${two}`;
  assert.equal(selectSaferReviewedArticle(draft, citationRegression, sourceText), draft);
});

test("fact review is accepted when it preserves protocol and uses evidence URLs", () => {
  const source = "https://source.example/report";
  const draft = `# 标题\n\n原始表述[来源](${source})。\n\n## 细节\n\n原文。\n\n## 参考来源\n\n- [来源](${source})`;
  const reviewed = `# 标题\n\n纠正后的表述[来源](${source})。\n\n## 细节\n\n纠正后的正文。\n\n## 参考来源\n\n- [来源](${source})`;
  assert.equal(selectSaferReviewedArticle(draft, reviewed, `链接：${source}`), reviewed);
});

test("citation planner adds only allow-listed links without rewriting prose or references", () => {
  const first = "https://source.example/first";
  const second = "https://source.example/second";
  const article = [
    "# 标题",
    "",
    "第一段有 71% 这个数字。",
    "",
    "## 资金流向",
    "",
    "第二段有 600 亿美元这个数字。",
    "",
    "## 参考来源",
    "",
    `- [一](${first})`,
    `- [二](${second})`
  ].join("\n");
  const revised = applyInlineCitationPlan({
    article,
    evidence: [
      { title: "一", sourceName: "来源一", url: first, summary: "71%" },
      { title: "二", sourceName: "来源二", url: second, summary: "600 亿美元" }
    ],
    plan: [
      { paragraphIndex: 0, sourceUrls: [first, "https://outside.example/x"] },
      { paragraphIndex: 1, sourceUrls: [second] }
    ]
  });
  assert.match(revised, new RegExp(`第一段有 71% 这个数字。 \\[来源：来源一\\]\\(${first.replace(/[.]/g, "\\.")}\\)`));
  assert.match(revised, new RegExp(`第二段有 600 亿美元这个数字。 \\[来源：来源二\\]\\(${second.replace(/[.]/g, "\\.")}\\)`));
  assert.doesNotMatch(revised, /outside\.example/);
  assert.equal(revised.slice(revised.indexOf("## 参考来源")), article.slice(article.indexOf("## 参考来源")));
});

test("missing reference section is rebuilt only from allow-listed inline sources", () => {
  const source = "https://source.example/report";
  const article = `# 标题\n\n根据[原始资料](${source})，指标发生变化。`;
  const restored = restoreMissingReferenceSection(article, [
    { title: "核验报告", sourceName: "机构", url: source, summary: "正文" },
    { title: "未使用报告", sourceName: "其他", url: "https://source.example/unused", summary: "正文" }
  ]);
  assert.match(restored, /## 参考来源/);
  assert.match(restored, /\[核验报告]\(https:\/\/source\.example\/report\)/);
  assert.doesNotMatch(restored, /unused/);
});

test("orphan numeric citation markers are stripped from prose but not from code or links", () => {
  const article = [
    "# 标题",
    "",
    "数据中心收入达到 752 亿美元，同比增长 92%，占总营收的绝大部分[2]。黄仁勋表示需求强劲[5]，市场保持谨慎[2][3]。",
    "",
    "不会暂停执行[来源 S6]。该准则由 13 名专家起草[来源 S4]，聚焦版权与安全（资料 S2）。",
    "",
    "调整后的框架【4】仍在推进。真实链接 [2](https://example.com/two) 和 [报告](https://example.com/r) 不受影响。",
    "",
    "```python",
    "row = data[1]",
    "```",
    "",
    "行内代码 `arr[3]` 与下标 matrix[2] 也保持原样。",
    "",
    "## 参考来源",
    "",
    "- [报告](https://example.com/r)"
  ].join("\n");

  const normalized = normalizeGeneratedArticleMarkdown(article);
  assert.doesNotMatch(normalized, /绝大部分\[2\]/);
  assert.doesNotMatch(normalized, /强劲\[5\]/);
  assert.doesNotMatch(normalized, /谨慎\[2\]\[3\]|谨慎\[3\]/);
  assert.doesNotMatch(normalized, /【4】/);
  assert.doesNotMatch(normalized, /\[来源 S6\]|\[来源 S4\]|（资料 S2）/);
  assert.match(normalized, /不会暂停执行。该准则由 13 名专家起草，聚焦版权与安全。/);
  assert.match(normalized, /\[2\]\(https:\/\/example\.com\/two\)/);
  assert.match(normalized, /row = data\[1\]/);
  assert.match(normalized, /`arr\[3\]`/);
  assert.match(normalized, /matrix\[2\]/);
});

test("marker stripping is idempotent and leaves clean articles unchanged", () => {
  const clean = "# 标题\n\n正文引用 [来源：路透社](https://example.com/a)。\n\n## 参考来源\n\n- [路透社](https://example.com/a)";
  assert.equal(stripOrphanNumericCitationMarkers(clean), clean);
});

test("citation planner can attach a source to the exact flagged list item", () => {
  const src = "https://source.example/honda";
  const article = [
    "# 标题",
    "",
    "导语段落说明背景。",
    "",
    "1. 消费电子 ：高通在2026年3月表示需求趋稳。",
    "2. 汽车制造 ：本田汽车在2026年3月披露减产计划。",
    "3. 云计算 ：厂商资本开支保持增长。",
    "",
    "## 参考来源",
    "",
    `- [本田公告](${src})`
  ].join("\n");
  // 清单里第 2 条（paragraphIndex: 导语=0，条目1=1，条目2=2，条目3=3）。
  const revised = applyInlineCitationPlan({
    article,
    evidence: [{ title: "本田公告", sourceName: "本田新闻室", url: src, summary: "本田 2026 年 3 月减产计划" }],
    plan: [{ paragraphIndex: 2, sourceUrls: [src] }]
  });
  const hondaLine = revised.split("\n").find((line) => line.includes("本田汽车"));
  assert.ok(hondaLine, "本田条目仍在");
  assert.match(hondaLine!, /\[来源：本田新闻室\]\(https:\/\/source\.example\/honda\)/);
  const qualcommLine = revised.split("\n").find((line) => line.includes("高通"));
  assert.doesNotMatch(qualcommLine!, /来源：/);
  // 列表结构保持三条，不合并、不换位。
  assert.equal(revised.split("\n").filter((line) => /^\d+\.\s/.test(line)).length, 3);
});

test("reference synchronization indexes a newly planned inline source", () => {
  const existing = "https://source.example/existing";
  const added = "https://source.example/newly-planned";
  const evidence = [
    { title: "Existing report", sourceName: "Existing", url: existing, summary: "Background" },
    { title: "EU fine report", sourceName: "Reuters", url: added, summary: "Fines range from 1% to 6% of EU sales" }
  ];
  const article = [
    "# 标题",
    "",
    `背景见[现有来源](${existing})。`,
    "",
    "违规罚款高达销售额的6%。",
    "",
    "## 参考来源",
    "",
    `- [Existing report](${existing})`
  ].join("\n");
  const planned = applyInlineCitationPlan({
    article,
    evidence,
    plan: [{ paragraphIndex: 1, sourceUrls: [added] }]
  });
  const synchronized = repairReferenceSectionLayout(planned, evidence);
  const references = synchronized.slice(synchronized.indexOf("## 参考来源"));
  assert.match(references, /source\.example\/existing/);
  assert.match(references, /source\.example\/newly-planned/);
});

test("reference layout repair moves stray prose back into the body and rebuilds the list", () => {
  const one = "https://source.example/one";
  const two = "https://source.example/two";
  const evidence = [
    { title: "关税决定报道，标题较长但仍在门禁允许的八十个有效字符以内，覆盖细节", sourceName: "来源一", url: one, summary: "x" },
    { title: "出口数据", sourceName: "来源二", url: two, summary: "y" }
  ];
  const article = [
    "# 标题",
    "",
    `正文引用了[来源一](${one})的关税决定。`,
    "",
    "## 参考来源",
    "",
    `- [来源一](${one})：这条列表项非法地追加了正文说明`,
    `- 相关阅读 [来源二](${two}) 以及更多背景`,
    "",
    "以上就是本文的全部内容，感谢阅读。"
  ].join("\n");

  const repaired = repairReferenceSectionLayout(article, evidence);
  // 尾部散文移回正文（位于参考来源之前）。
  const referenceIndex = repaired.indexOf("## 参考来源");
  assert.ok(repaired.slice(0, referenceIndex).includes("感谢阅读"));
  // 列表重建为“标题 + 链接”，不再有追加正文。
  const tail = repaired.slice(referenceIndex);
  assert.doesNotMatch(tail, /追加了正文说明|相关阅读|感谢阅读/);
  assert.match(tail, /- \[关税决定报道[^\]]*\]\(https:\/\/source\.example\/one\)/);
  assert.match(tail, /- \[出口数据\]\(https:\/\/source\.example\/two\)/);
  // 正文引用过的来源排在前面。
  assert.ok(tail.indexOf(one) < tail.indexOf(two));
});

test("reference layout repair leaves articles without allow-listed reference links unchanged", () => {
  const article = "# 标题\n\n正文。\n\n## 参考来源\n\n- [外部](https://outside.example/x)";
  assert.equal(repairReferenceSectionLayout(article, [{ title: "一", sourceName: "一", url: "https://source.example/one", summary: "x" }]), article);
});
