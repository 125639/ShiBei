import test from "node:test";
import assert from "node:assert/strict";
import { computeMaxTokens, isReasoningModel, noteObservedReasoningUsage } from "../src/lib/ai";

test("DeepSeek V3.1+/V4 hybrid-thinking models count as reasoning models", () => {
  assert.equal(isReasoningModel("deepseek-v4-flash"), true);
  assert.equal(isReasoningModel("deepseek/deepseek-v3.2"), true);
  assert.equal(isReasoningModel("deepseek-r1"), true);
  assert.equal(isReasoningModel("deepseek-chat"), false);
  assert.equal(isReasoningModel("deepseek-v3"), false);
  assert.equal(isReasoningModel("gpt-4.1-mini"), false);
});

test("hidden reasoning observed in usage promotes an unknown model to reasoning budget", () => {
  const model = "mystery-gateway-model";
  assert.equal(isReasoningModel(model), false);
  assert.equal(noteObservedReasoningUsage(model, { completion_tokens_details: { reasoning_tokens: 0 } }, { content: "x" }), false);
  assert.equal(isReasoningModel(model), false);
  assert.equal(noteObservedReasoningUsage(model, { completion_tokens_details: { reasoning_tokens: 212 } }, { content: "x" }), true);
  assert.equal(isReasoningModel(model), true);
  // 第二次观测不再报告新增
  assert.equal(noteObservedReasoningUsage(model, { completion_tokens_details: { reasoning_tokens: 5 } }, { content: "x" }), false);
});

test("non-empty reasoning_content also counts as hidden reasoning", () => {
  const model = "another-gateway-model";
  assert.equal(noteObservedReasoningUsage(model, undefined, { content: "x", reasoning_content: "让我想想…" }), true);
  assert.equal(isReasoningModel(model), true);
});

test("reasoning floor lifts task caps but never exceeds the configured budget when it is higher", () => {
  const cfg = { model: "deepseek-v4-flash", maxTokens: 24000 };
  // 长文任务：任务级上限 4200，reasoning 模型抬到 16000 下限
  assert.equal(computeMaxTokens(cfg, 4200, 4200), 16000);
  // 解除任务级上限后用满管理员配置
  assert.equal(computeMaxTokens(cfg, 4200), 24000);
  // 普通模型仍按任务上限执行
  assert.equal(computeMaxTokens({ model: "gpt-4.1-mini", maxTokens: 24000 }, 4200, 4200), 4200);
  // 管理员配得比下限低时，reasoning 模型仍至少拿到下限
  assert.equal(computeMaxTokens({ model: "deepseek-v4-flash", maxTokens: 8000 }, 4200, 4200), 16000);
});
