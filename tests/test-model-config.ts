import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelConfigManager, ModelIdField } from "../src/components/admin/ModelConfigManager";
import {
  ModelConfigValidationError,
  canReuseSavedModelKey,
  modelApiUrl,
  normalizeModelBaseUrl,
  parseModelConfigForm,
  replaceSiteModelReferences
} from "../src/lib/model-config-input";
import {
  MODEL_COMPLETION_RESPONSE_LIMIT,
  MODEL_LIST_RESPONSE_LIMIT,
  readLimitedModelResponse,
  safeModelProviderHttpError,
  sanitizeModelProviderText
} from "../src/lib/model-provider-error";
import { providerThinkingOptions } from "../src/lib/model-providers";

describe("model configuration input", () => {
  test("browser validation accepts provider model paths containing lowercase s", () => {
    const html = renderToStaticMarkup(createElement(ModelConfigManager, { configs: [] }));
    const input = html.match(/<input id="model"[^>]*>/)?.[0];
    assert.ok(input, "model ID input should be rendered");

    const pattern = input.match(/\bpattern="([^"]+)"/)?.[1];
    assert.equal(pattern, "\\S+");
    const browserPattern = new RegExp(`^(?:${pattern})$`, "u");

    for (const modelId of [
      "deepseek-ai/DeepSeek-V3.2",
      "models/gemini-2.5-pro",
      "moonshotai/Kimi-K2.5",
      "Qwen/Qwen3.5-27B"
    ]) {
      assert.equal(browserPattern.test(modelId), true, modelId);
    }
    assert.equal(browserPattern.test("deepseek chat"), false);
  });

  test("keeps task routing separate from collapsed connection management", () => {
    const html = renderToStaticMarkup(createElement(ModelConfigManager, {
      configs: [{
        id: "model-main",
        provider: "deepseek",
        name: "主力写作",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        temperature: 0.3,
        maxTokens: 12000,
        isDefault: true
      }],
      assignments: {
        contentModelConfigId: "model-main",
        assistantModelConfigId: "",
        writingModelConfigId: "",
        translationModelConfigId: ""
      }
    }));

    assert.match(html, /action="\/api\/admin\/settings\/model-routing"/);
    for (const role of [
      "contentModelConfigId",
      "assistantModelConfigId",
      "writingModelConfigId",
      "translationModelConfigId"
    ]) {
      assert.match(html, new RegExp(`name="${role}"`));
    }
    assert.match(html, /研究与文章生成/);
    assert.match(html, /承接默认任务/);
    assert.match(html, /英文翻译会先跟随站内 AI 助手，再回退到默认模型/);
    assert.match(html, /跟随站内助手，再回退默认/);
    assert.match(html, /<details class="model-config-row">/);
    assert.match(html, /<details class="model-config-advanced">/);
    const baseUrlInput = html.match(/<input id="baseUrl"[^>]*>/)?.[0] || "";
    assert.match(baseUrlInput, /name="baseUrl"/);
    assert.match(baseUrlInput, /pattern="https:\/\/.\+"/);
    assert.doesNotMatch(html, /name="stream"/);
  });

  test("shows a concrete provider-model selector while retaining manual model ID input", () => {
    const html = renderToStaticMarkup(createElement(ModelIdField, {
      id: "model-id-model-qwen",
      value: "Qwen/Qwen3.5-27B",
      onChange: () => undefined,
      options: ["qwen-plus", "Qwen/Qwen3.5-27B"]
    }));

    assert.match(html, /id="model-id-model-qwen-select"/);
    assert.match(html, /供应商返回的模型（2 个）/);
    assert.match(html, /id="model-id-model-qwen"[^>]+name="model"/);
    assert.match(html, /pattern="\\S\+"/);
  });

  test("normalizes host, /models and full chat completion URLs", () => {
    assert.equal(normalizeModelBaseUrl(" https://api.example.com/v1/ "), "https://api.example.com/v1");
    assert.equal(normalizeModelBaseUrl("https://api.example.com/v1/models"), "https://api.example.com/v1");
    assert.equal(
      normalizeModelBaseUrl("https://api.example.com/v1/chat/completions"),
      "https://api.example.com/v1"
    );
    assert.equal(modelApiUrl("https://api.example.com/v1/", "chat/completions"), "https://api.example.com/v1/chat/completions");
    assert.equal(
      modelApiUrl("https://api.example.com/v1/chat/completions", "chat/completions"),
      "https://api.example.com/v1/chat/completions"
    );
  });

  test("adding a second connection does not silently replace the default model", () => {
    const html = renderToStaticMarkup(createElement(ModelConfigManager, {
      configs: [{
        id: "existing-default",
        provider: "deepseek",
        name: "现有默认",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        temperature: 0.3,
        maxTokens: 8000,
        isDefault: true
      }]
    }));
    const addForm = html.match(/<form class="form-stack model-config-create"[\s\S]*?<\/form>/)?.[0] || "";
    assert.doesNotMatch(addForm, /name="isDefault"[^>]*checked/);
  });

  test("never reuses a saved key after the canonical endpoint changes", () => {
    assert.equal(
      canReuseSavedModelKey("https://api.example.com/v1/", "https://api.example.com/v1/chat/completions"),
      true
    );
    assert.equal(canReuseSavedModelKey("https://api.old.example/v1", "https://api.new.example/v1"), false);
    assert.equal(canReuseSavedModelKey("https://api.example.com/v1", "https://api.example.com/v2"), false);
  });

  test("rejects malformed or credential-bearing base URLs", () => {
    for (const value of [
      "api.example.com/v1",
      "http://api.example.com/v1",
      "ftp://api.example.com/v1",
      "https://user:pass@api.example.com/v1",
      "https://api.example.com/v1?key=secret",
      "https://api.example.com/v1#fragment"
    ]) {
      assert.throws(() => normalizeModelBaseUrl(value), ModelConfigValidationError);
    }
  });

  test("trims valid fields and requires a key for new configs", () => {
    const form = validForm();
    const parsed = parseModelConfigForm(form, { requireApiKey: true });
    assert.deepEqual(parsed, {
      provider: "deepseek",
      name: "主力模型",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      apiKey: "sk-test",
      temperature: 0.4,
      maxTokens: 12000,
      isEnabled: true,
      isDefault: true
    });
    assert.equal("stream" in parsed, false, "legacy stream input must be ignored");

    form.set("apiKey", "  ");
    assert.throws(
      () => parseModelConfigForm(form, { requireApiKey: true }),
      (error) => error instanceof ModelConfigValidationError && error.code === "invalid_api_key"
    );
    assert.equal(parseModelConfigForm(form, { requireApiKey: false }).apiKey, "");
  });

  test("rejects whitespace model IDs and out-of-range generation values", () => {
    const form = validForm();
    form.set("model", "not a model id");
    assert.throws(
      () => parseModelConfigForm(form, { requireApiKey: true }),
      (error) => error instanceof ModelConfigValidationError && error.code === "invalid_model"
    );

    form.set("model", "deepseek-chat");
    form.set("temperature", "2.1");
    assert.throws(
      () => parseModelConfigForm(form, { requireApiKey: true }),
      (error) => error instanceof ModelConfigValidationError && error.code === "invalid_temperature"
    );

    form.set("temperature", "0.3");
    form.set("maxTokens", "2.5");
    assert.throws(
      () => parseModelConfigForm(form, { requireApiKey: true }),
      (error) => error instanceof ModelConfigValidationError && error.code === "invalid_max_tokens"
    );
  });

  test("falls unknown legacy providers back to custom without losing endpoint/model", () => {
    const form = validForm();
    form.set("provider", "legacy-provider");
    const parsed = parseModelConfigForm(form, { requireApiKey: true });
    assert.equal(parsed.provider, "custom");
    assert.equal(parsed.baseUrl, "https://api.deepseek.com/v1");
    assert.equal(parsed.model, "deepseek-chat");
  });

  test("only repoints site roles that referenced a removed config", () => {
    assert.deepEqual(
      replaceSiteModelReferences(
        {
          contentModelConfigId: "remove-me",
          assistantModelConfigId: "keep-me",
          writingModelConfigId: "remove-me",
          translationModelConfigId: null
        },
        "remove-me",
        "replacement"
      ),
      {
        contentModelConfigId: "replacement",
        writingModelConfigId: "replacement"
      }
    );
    assert.deepEqual(replaceSiteModelReferences(null, "remove-me", null), {});
  });

  test("disables thinking only for SiliconFlow Qwen3 publication requests", () => {
    assert.deepEqual(
      providerThinkingOptions(
        { baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen3.5-27B" },
        true
      ),
      { enable_thinking: false }
    );
    assert.deepEqual(
      providerThinkingOptions(
        { baseUrl: "https://api.example.com/v1", model: "Qwen/Qwen3.5-27B" },
        true
      ),
      {}
    );
    assert.deepEqual(
      providerThinkingOptions(
        { baseUrl: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V3" },
        true
      ),
      {}
    );
    assert.deepEqual(
      providerThinkingOptions(
        { baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen3.5-27B" },
        false
      ),
      {}
    );
  });

  test("sanitizes provider errors without reflecting credentials or raw bodies", () => {
    const apiKey = "plain-secret-123";
    const message = safeModelProviderHttpError(
      401,
      JSON.stringify({
        error: {
          message: `invalid api_key=${apiKey}; Authorization: Bearer sk-provider-leak-456`
        },
        debug: "raw-debug-body-must-not-appear"
      }),
      [apiKey]
    );
    assert.match(message, /^供应商返回 HTTP 401：/);
    assert.doesNotMatch(message, /plain-secret-123|sk-provider-leak-456|raw-debug-body/);
    assert.match(message, /已隐藏/);

    const htmlBody = safeModelProviderHttpError(
      502,
      `<html>proxy dump ${apiKey} sk-html-leak</html>`,
      [apiKey]
    );
    assert.equal(htmlBody, "供应商返回 HTTP 502");

    assert.doesNotMatch(
      sanitizeModelProviderText(`Bearer ${apiKey} and sk-another-secret`, [apiKey]),
      /plain-secret-123|sk-another-secret/
    );
  });

  test("uses an independent bounded response budget for large model catalogues", async () => {
    assert.equal(MODEL_LIST_RESPONSE_LIMIT, 2 * 1024 * 1024);
    assert.ok(MODEL_COMPLETION_RESPONSE_LIMIT < MODEL_LIST_RESPONSE_LIMIT);

    const catalogue = "x".repeat(MODEL_COMPLETION_RESPONSE_LIMIT + 1);
    await assert.rejects(
      readLimitedModelResponse(new Response(catalogue), MODEL_COMPLETION_RESPONSE_LIMIT),
      /供应商响应过大/
    );
    assert.equal(
      (await readLimitedModelResponse(new Response(catalogue), MODEL_LIST_RESPONSE_LIMIT)).length,
      catalogue.length
    );
  });

  test("migration deterministically repairs duplicate defaults before adding the partial unique index", () => {
    const sql = readFileSync(
      new URL("../prisma/migrations/20260714050000_model_config_default_integrity/migration.sql", import.meta.url),
      "utf8"
    );
    assert.match(sql, /ROW_NUMBER\(\) OVER/);
    assert.match(sql, /ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" ASC/);
    assert.match(sql, /CREATE UNIQUE INDEX "ModelConfig_single_default_key"/);
    assert.match(sql, /WHERE "isDefault" = TRUE/);
    assert.match(sql, /UPDATE "ModelConfig" SET "stream" = FALSE/);
  });

  test("connections can be disabled without deleting credentials and are excluded from routing", () => {
    const html = renderToStaticMarkup(createElement(ModelConfigManager, {
      configs: [{
        id: "disabled-model",
        provider: "custom",
        name: "暂时故障的连接",
        baseUrl: "https://api.example.com/v1",
        model: "example-model",
        temperature: 0.3,
        maxTokens: 8000,
        isEnabled: false,
        isDefault: false
      }]
    }));
    assert.match(html, /已停用/);
    assert.match(html, /停用会保留地址与密钥/);
    assert.doesNotMatch(html, /<option value="disabled-model">/);

    const form = validForm();
    form.set("_enabledPresented", "true");
    form.delete("isEnabled");
    assert.equal(parseModelConfigForm(form, { requireApiKey: true }).isEnabled, false);
  });
});

function validForm() {
  const form = new FormData();
  form.set("provider", "deepseek");
  form.set("name", "  主力模型  ");
  form.set("baseUrl", " https://api.deepseek.com/v1/ ");
  form.set("model", " deepseek-chat ");
  form.set("apiKey", " sk-test ");
  form.set("temperature", "0.4");
  form.set("maxTokens", "12000");
  form.set("stream", "true");
  form.set("isDefault", "true");
  return form;
}
