import assert from "node:assert/strict";
import test from "node:test";
import {
  editorialSystemPrompt,
  formatStyleBlock,
  modeInstruction,
  publicationWritingRules,
  sourceBoundaryRules
} from "../src/lib/ai";
import { DEFAULT_BLOG_STYLE, isLegacyBundledStyle, normalizeContentMode } from "../src/lib/content-style";

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
  assert.match(publicationWritingRules(), /禁止默认套用/);
  assert.match(publicationWritingRules(), /绝不为达到长度/);
  assert.match(publicationWritingRules(), /真正重要的是/);
  assert.match(publicationWritingRules(), /结构应由证据决定/);
  assert.match(publicationWritingRules(), /像熟悉主题的作者/);
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
