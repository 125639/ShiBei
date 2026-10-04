import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelRequestError,
  recoverDraftAfterReviewFailure,
  runWithRoutedModelFallback,
  type ChatModelConfig
} from "../src/lib/ai";
import { buildModelFallbackChain, selectModelConfigForUse, type ModelUse } from "../src/lib/model-selection";

function config(model: string): ChatModelConfig {
  return {
    baseUrl: "https://models.example/v1",
    model,
    apiKeyEnc: "encrypted",
    temperature: 0.3,
    maxTokens: 4000
  };
}

test("role-routed model calls fail over after retryable provider outages", async () => {
  const attempts: string[] = [];
  const warnings: string[] = [];
  const primary = { ...config("primary"), fallbackConfigs: [config("fallback")] };
  const result = await runWithRoutedModelFallback(primary, async (candidate) => {
    attempts.push(candidate.model);
    if (candidate.model === "primary") throw new ModelRequestError("HTTP 503", { retryable: true });
    return "ok";
  }, { warn(message) { warnings.push(String(message)); } });
  assert.equal(result, "ok");
  assert.deepEqual(attempts, ["primary", "fallback"]);
  assert.equal(warnings.length, 1);
});

test("invalid credentials and truncated output never switch models", async () => {
  for (const error of [
    new ModelRequestError("bad key", { retryable: false }),
    new ModelRequestError("length", { retryable: false, truncated: true })
  ]) {
    const attempts: string[] = [];
    const primary = { ...config("primary"), fallbackConfigs: [config("fallback")] };
    await assert.rejects(runWithRoutedModelFallback(primary, async (candidate) => {
      attempts.push(candidate.model);
      throw error;
    }, { warn() {} }), error);
    assert.deepEqual(attempts, ["primary"]);
  }
});

test("an explicit model config remains pinned because it has no fallback list", async () => {
  const attempts: string[] = [];
  await assert.rejects(runWithRoutedModelFallback(config("benchmark-model"), async (candidate) => {
    attempts.push(candidate.model);
    throw new ModelRequestError("HTTP 503", { retryable: true });
  }, { warn() {} }), /HTTP 503/);
  assert.deepEqual(attempts, ["benchmark-model"]);
});

test("a queued job keeps its selected model first and can use every other configured connection", () => {
  const chain = buildModelFallbackChain([
    { id: "default", model: "gpt" },
    { id: "writing", model: "deepseek" },
    { id: "third", model: "qwen" }
  ], "writing");

  assert.equal(chain?.model, "deepseek");
  assert.deepEqual(chain?.fallbackConfigs.map((item) => item.model), ["gpt", "qwen"]);
  assert.equal(buildModelFallbackChain([{ id: "only" }], "missing"), null);
});

test("all normal roles retain chat defaults and fallback ordering", () => {
  const configs = [
    { id: "default", provider: "custom", model: "default-chat", isDefault: true },
    { id: "assistant", provider: "custom", model: "assistant-chat", isDefault: false },
    { id: "secondary", provider: "custom", model: "secondary-chat", isDefault: false }
  ];
  const settings = {
    contentModelConfigId: "default", assistantModelConfigId: "assistant",
    writingModelConfigId: "default", translationModelConfigId: "default"
  };
  for (const use of ["content", "assistant", "writing", "translation"] as ModelUse[]) {
    const result = selectModelConfigForUse(use, settings, configs);
    assert.equal(result?.id, use === "assistant" ? "assistant" : "default");
    assert.deepEqual(result?.fallbackConfigs.map((item) => item.id),
      use === "assistant" ? ["default", "secondary"] : ["assistant", "secondary"]);
  }
  assert.deepEqual(buildModelFallbackChain(configs, "secondary")?.fallbackConfigs.map((item) => item.id), ["default", "assistant"]);
});

test("normal explicit assignments and translation fallback behavior remain unchanged", () => {
  const configs = [
    { id: "default", provider: "custom", model: "default-chat", isEnabled: true },
    { id: "assigned", provider: "deepseek", model: "deepseek-chat", isEnabled: true },
    { id: "disabled", provider: "custom", model: "disabled-chat", isEnabled: false }
  ];
  for (const use of ["content", "assistant", "writing", "translation"] as ModelUse[]) {
    assert.equal(selectModelConfigForUse(use, null, configs)?.id, "default");
    assert.equal(selectModelConfigForUse(use, {
      contentModelConfigId: "assigned", assistantModelConfigId: "assigned", writingModelConfigId: "assigned",
      translationModelConfigId: "assigned"
    }, configs)?.id, "assigned");
  }
  assert.equal(selectModelConfigForUse("translation", { assistantModelConfigId: "assigned" }, configs)?.id, "assigned");
  assert.equal(selectModelConfigForUse("translation", { assistantModelConfigId: "disabled" }, configs)?.id, "default");
  assert.deepEqual(selectModelConfigForUse("content", { contentModelConfigId: "disabled" }, configs)?.fallbackConfigs.map((config) => config.id), ["assigned"]);
});

test("a failed optional review preserves the complete draft for deterministic publication checks", () => {
  const draft = "# 可核验标题\n\n正文。\n\n## 参考来源\n\n- [来源](https://example.com/report)\n\n";
  assert.equal(
    recoverDraftAfterReviewFailure(draft, new ModelRequestError("review timed out", { retryable: true })),
    draft.trim()
  );
  assert.throws(
    () => recoverDraftAfterReviewFailure(draft, new Error("local parser bug")),
    /local parser bug/
  );
});
