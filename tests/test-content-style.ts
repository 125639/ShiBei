import assert from "node:assert/strict";
import test from "node:test";
import { formatStyleBlock, modeInstruction, sourceBoundaryRules } from "../src/lib/ai";
import { normalizeContentMode } from "../src/lib/content-style";

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
  assert.match(block, /事实边界|管理员自定义要求/);
});

test("mode instructions distinguish non-news article forms", () => {
  assert.match(modeInstruction("tutorial"), /操作步骤/);
  assert.match(modeInstruction("opinion"), /事实、推论和价值判断/);
  assert.match(modeInstruction("essay"), /随笔专栏/);
  assert.match(sourceBoundaryRules(), /不编造数据/);
});
