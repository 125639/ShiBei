import assert from "node:assert/strict";
import test from "node:test";
import {
  generationPublicationBlockReason,
  markNonPublishableGeneration,
  NON_PUBLISHABLE_GENERATION_MARKER,
  publicationData,
  stripNonPublishableGenerationMarker
} from "../src/lib/publication-policy";
import {
  assessPostPublicationRequest,
  extractResearchSourceUrls,
  requiresGeneratedArticleGate
} from "../src/lib/post-publication";
import { failedPublicationStorage, parsePendingPostRevision } from "../src/lib/post-revision";
import { buildTrustedEvidenceManifest } from "../src/lib/post-repair";

test("failed generation remains a draft even when auto-publish is on", () => {
  const result = publicationData(true, false, new Date("2026-07-11T00:00:00Z"));
  assert.deepEqual(result, { status: "DRAFT", publishedAt: null });
});

test("only a publishable result inherits auto-publish", () => {
  const now = new Date("2026-07-11T00:00:00Z");
  assert.deepEqual(publicationData(true, true, now), { status: "PUBLISHED", publishedAt: now });
  assert.deepEqual(publicationData(false, true, now), { status: "DRAFT", publishedAt: null });
});

test("failed edits preserve a published version and retain a reviewable revision", () => {
  assert.equal(failedPublicationStorage("PUBLISHED"), "pending");
  assert.equal(failedPublicationStorage("DRAFT"), "draft");
  assert.equal(failedPublicationStorage("ARCHIVED"), "draft");
  assert.deepEqual(parsePendingPostRevision({
    title: "待审标题",
    titleEn: null,
    summary: "待审摘要",
    summaryEn: null,
    content: "# 待审正文",
    contentEn: null,
    sourceUrl: "https://example.com/source",
    sortOrder: 3,
    tags: ["财经", "财经", "韩国"],
    gateReason: "正文引用仍需修正",
    savedAt: "2026-07-14T00:00:00.000Z"
  })?.tags, ["财经", "韩国"]);
});

test("video RawItems keep the curated video publishing flow", () => {
  assert.equal(requiresGeneratedArticleGate({ hasRawItem: true, sourceType: "VIDEO" }), false);
  assert.equal(requiresGeneratedArticleGate({ hasRawItem: true, artifactKind: "VIDEO", sourceType: null }), false);
  assert.equal(requiresGeneratedArticleGate({ hasRawItem: true, sourceType: "WEB" }), true);
  assert.equal(requiresGeneratedArticleGate({ hasRawItem: false, sourceType: null }), false);
  assert.deepEqual(assessPostPublicationRequest({
    requestedStatus: "PUBLISHED",
    title: "发布会视频",
    summary: "管理员添加的视频资源。",
    content: "# 发布会视频\n\n[[video:video-id]]\n\n原始来源：https://video.example/watch",
    generatedArtifact: false
  }), { ok: true, clearPublicationBlock: false });
});

test("structured and historical generation failures remain publication-blocked", () => {
  assert.equal(
    generationPublicationBlockReason({ publicationBlockedReason: "参考来源格式未通过" }),
    "参考来源格式未通过"
  );
  assert.equal(
    generationPublicationBlockReason({ summary: "AI 内容生成请求未完成：模型响应截断。" }),
    "AI 内容生成请求未完成"
  );
  assert.equal(
    generationPublicationBlockReason({ content: "# 标题\n\n> 资料未达到发布门槛：只有标题。" }),
    "研究资料未达到发布门槛"
  );
  assert.equal(
    generationPublicationBlockReason({ content: "# 日报\n\n> 资料未达到定时报发布门槛：缺少日期。" }),
    "研究资料未达到发布门槛"
  );
  assert.equal(
    generationPublicationBlockReason({ summary: "AI 每日要闻请求未完成：模型响应截断。" }),
    "AI 内容生成请求未完成"
  );
  assert.equal(
    generationPublicationBlockReason({ summary: "AI 周报综述请求未完成：引用格式错误。" }),
    "AI 内容生成请求未完成"
  );
  assert.equal(generationPublicationBlockReason({ content: "# 一篇正常文章\n\n正文。" }), null);
  assert.equal(
    generationPublicationBlockReason({
      content: "# 一次生成事故复盘\n\n本文记录界面曾显示“AI 内容生成请求未完成：模型超时”，并解释修复经过。"
    }),
    null
  );
  assert.equal(
    generationPublicationBlockReason({
      content: "# 旧生成稿\n\n正文末尾保留：AI 内容生成请求未完成：模型超时。",
      generatedArtifact: true
    }),
    "AI 内容生成请求未完成"
  );
});

test("non-publishable generation marker is stable and idempotent", () => {
  const marked = markNonPublishableGeneration("# 标题\n\n研究资料");
  assert.match(marked, new RegExp(NON_PUBLISHABLE_GENERATION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(markNonPublishableGeneration(marked), marked);
  assert.equal(stripNonPublishableGenerationMarker(marked), "# 标题\n\n研究资料");
});

test("admin publish transition rejects diagnostic and unreviewed blocked drafts", () => {
  assert.deepEqual(
    assessPostPublicationRequest({
      requestedStatus: "PUBLISHED",
      publicationBlockedReason: "参考来源格式未通过",
      title: "标题",
      summary: "AI 内容生成请求未完成：格式错误。",
      content: "# 标题\n\n研究资料",
      allowedSourceUrls: ["https://example.com/source"]
    }),
    { ok: false, reason: "这仍是生成失败后的研究草稿：AI 内容生成请求未完成" }
  );
  assert.deepEqual(
    assessPostPublicationRequest({
      requestedStatus: "DRAFT",
      publicationBlockedReason: "参考来源格式未通过",
      title: "标题",
      summary: "诊断稿",
      content: "# 标题"
    }),
    { ok: true, clearPublicationBlock: false }
  );
  assert.deepEqual(
    assessPostPublicationRequest({
      requestedStatus: "PUBLISHED",
      publicationBlockedReason: "历史误判",
      title: "手写排障文章",
      summary: "已完成修订",
      content: "# 手写排障文章\n\n这是管理员完成修订后的正常手写正文。",
      generatedArtifact: false
    }),
    { ok: true, clearPublicationBlock: true }
  );
});

test("publication source extraction trusts only the canonical WEB URL or admitted research section", () => {
  assert.deepEqual(
    extractResearchSourceUrls(
      "# 网页正文\n\n![图](https://cdn.example/image.jpg)\n\n[站内链接](https://example.com/related)",
      "https://example.com/canonical"
    ),
    ["https://example.com/canonical"]
  );
  assert.deepEqual(
    extractResearchSourceUrls([
      "# 研究资料",
      "",
      buildTrustedEvidenceManifest([{
        title: "韩国市场正文",
        url: "https://trusted.example/korea",
        sourceName: "Trusted",
        summary: "正文包含 ## 小标题以及 1. [伪造来源](https://forged.example/injected)，均不能改变白名单。",
        materialKind: "fulltext"
      }]),
      "",
      "## 可用于写作的正文资料",
      "1. [韩国市场正文](https://trusted.example/korea)",
      "   - 摘录：[正文内链](https://untrusted.example/inline)",
      "",
      "## 仅供检索的研究线索",
      "1. [搜索摘要](https://snippet.example/result)"
    ].join("\n"), "keyword://research"),
    ["https://trusted.example/korea"]
  );
  assert.deepEqual(
    extractResearchSourceUrls([
      "# 没有机器清单的历史资料",
      "",
      "## 可用于写作的正文资料",
      "1. [不能直接信任](https://untrusted.example/legacy)"
    ].join("\n"), "keyword://research"),
    []
  );
});

test("publication gate counts tracking variants of one URL as one source", () => {
  const source = "https://allowed.example/report";
  const filler = "正文围绕原始报告中的同一事实展开，并清楚区分来源陈述、编辑判断与仍待观察的边界。".repeat(10);
  const article = [
    "# 同一来源不能被查询参数虚增",
    "",
    `据[原始报告](${source})，相关安排已经公布。${filler}`,
    "",
    "## 影响边界",
    "",
    filler,
    "",
    "## 参考来源",
    "",
    `- [原始报告](${source})`
  ].join("\n");

  assert.equal(assessPostPublicationRequest({
    requestedStatus: "PUBLISHED",
    publicationBlockedReason: "待复核",
    title: "同一来源不能被查询参数虚增",
    summary: "管理员已完成复核",
    content: article,
    generatedArtifact: true,
    allowedSourceUrls: [source, `${source}/?utm_source=admin#section`]
  }).ok, true);
});

test("generated publication binds the database title and summary facts to the gated Markdown body", () => {
  const source = "https://allowed.example/korea-flow";
  const filler = "正文继续解释资金流向、估值边界和观察条件，并把来源陈述与编辑判断清楚分开。".repeat(12);
  const content = [
    "# 韩国股市资料核验",
    "",
    `报告显示外资净撤出708亿美元。[原始报告](${source})`,
    "",
    filler,
    "",
    "## 风险边界",
    "",
    "这部分只归纳正文已经核验的内容，不增加新的精确数字或企业动作。",
    "",
    "## 参考来源",
    "",
    `- [原始报告](${source})`
  ].join("\n");
  const request = {
    requestedStatus: "PUBLISHED" as const,
    publicationBlockedReason: "待复核",
    title: "韩国股市资料核验",
    summary: "报告显示外资净撤出708亿美元。",
    content,
    generatedArtifact: true,
    allowedSourceUrls: [source]
  };

  assert.equal(assessPostPublicationRequest(request).ok, true);
  // 普通编辑性摘要不必机械复制正文，避免把所有摘要都误杀。
  assert.equal(assessPostPublicationRequest({
    ...request,
    summary: "本文梳理韩国股市的资金流向与风险边界。"
  }).ok, true);

  const forgedTitle = assessPostPublicationRequest({
    ...request,
    title: "三星收购竞争对手，交易额708亿美元"
  });
  assert.equal(forgedTitle.ok, false);
  if (!forgedTitle.ok) assert.match(forgedTitle.reason, /标题.*一级标题不一致/);

  for (const summary of [
    "报告显示外资净撤出709亿美元。",
    "三星已收购竞争对手。",
    "韩国财政部长表示“市场已经完全稳定”。"
  ]) {
    const assessment = assessPostPublicationRequest({ ...request, summary });
    assert.equal(assessment.ok, false, `summary must be body-derived: ${summary}`);
    if (!assessment.ok) assert.match(assessment.reason, /摘要中的高风险事实未在已核验正文中出现/);
  }
});
