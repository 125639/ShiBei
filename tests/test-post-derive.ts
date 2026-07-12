import assert from "node:assert/strict";
import test from "node:test";
import { extractTitleAndSummary, summaryDuplicatesContentLead } from "../src/lib/post-derive";

test("summary stops at the first section instead of leaking template headings", () => {
  const result = extractTitleAndSummary([
    "# 一个具体标题",
    "",
    "这是一段短而完整的导语。",
    "",
    "## 摘要",
    "",
    "不应进入卡片摘要的内容。",
    "",
    "## 关键点",
    "",
    "更多正文。"
  ].join("\n"), "fallback");

  assert.equal(result.title, "一个具体标题");
  assert.equal(result.summary, "这是一段短而完整的导语。");
});

test("summary keeps Markdown link anchor text", () => {
  const result = extractTitleAndSummary(
    "# 标题\n\n据[官方公告](https://example.com/source)，产品将在七月发布。\n\n## 细节\n\n正文。",
    "fallback"
  );

  assert.equal(result.summary, "据官方公告，产品将在七月发布。");
});

test("articles that start at H2 fall back to its first prose paragraph", () => {
  const result = extractTitleAndSummary("# 标题\n\n## 事实\n\n第一段正文。\n\n## 后续\n\n第二段。", "fallback");
  assert.equal(result.summary, "第一段正文。");
});

test("detects a card summary copied or truncated from the article lead", () => {
  const content = "# 标题\n\n这是一段足够长的正文导语，用来说明最重要的事实、发生时间以及这件事为何影响现有流程。\n\n## 具体变化\n\n正文。";
  assert.equal(summaryDuplicatesContentLead(content, "标题", "这是一段足够长的正文导语，用来说明最重要的事实"), true);
  assert.equal(summaryDuplicatesContentLead(content, "标题", "这是编辑另外撰写的一段独立摘要，讨论的是不同角度和适用范围。"), false);
});
