// node --test tests/test-seed.mjs
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildModelConfigInput,
  shouldSeedAiModel,
  buildAdminUpsertArgs
} from "../prisma/seed-helpers.mjs";

describe("buildModelConfigInput", () => {
  test("returns null when INIT_AI_PROVIDER is missing", () => {
    assert.equal(buildModelConfigInput({}), null);
  });

  test("returns null when INIT_AI_PROVIDER is empty string", () => {
    assert.equal(buildModelConfigInput({ INIT_AI_PROVIDER: "" }), null);
  });

  test("returns null when INIT_AI_PROVIDER is whitespace only", () => {
    assert.equal(buildModelConfigInput({ INIT_AI_PROVIDER: "   " }), null);
  });

  test("returns full input when all fields provided", () => {
    const input = buildModelConfigInput({
      INIT_AI_PROVIDER: "deepseek",
      INIT_AI_NAME: "DeepSeek Chat",
      INIT_AI_BASE_URL: "https://api.deepseek.com/v1",
      INIT_AI_MODEL: "deepseek-chat",
      INIT_AI_API_KEY: "sk-test-1234"
    });
    assert.deepEqual(input, {
      provider: "deepseek",
      name: "DeepSeek Chat",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      apiKey: "sk-test-1234"
    });
  });

  test("trims surrounding whitespace from string fields", () => {
    const input = buildModelConfigInput({
      INIT_AI_PROVIDER: "  openai  ",
      INIT_AI_NAME: "  OpenAI  ",
      INIT_AI_BASE_URL: " https://api.openai.com/v1 ",
      INIT_AI_MODEL: "  gpt-4o-mini  ",
      INIT_AI_API_KEY: "sk-untouched"
    });
    assert.equal(input.provider, "openai");
    assert.equal(input.name, "OpenAI");
    assert.equal(input.baseUrl, "https://api.openai.com/v1");
    assert.equal(input.model, "gpt-4o-mini");
    // API key intentionally NOT trimmed: keys may legally have padding-looking
    // characters, and the seed encrypts whatever the user typed.
    assert.equal(input.apiKey, "sk-untouched");
  });

  test("falls back to defaults when only provider is set", () => {
    const input = buildModelConfigInput({ INIT_AI_PROVIDER: "openai" });
    assert.equal(input.provider, "openai");
    assert.equal(input.name, "默认模型");
    assert.equal(input.baseUrl, "https://api.openai.com/v1");
    assert.equal(input.model, "gpt-4o-mini");
    assert.equal(input.apiKey, "");
  });

  test("treats empty string fields as missing (uses defaults)", () => {
    const input = buildModelConfigInput({
      INIT_AI_PROVIDER: "qwen",
      INIT_AI_NAME: "",
      INIT_AI_BASE_URL: "",
      INIT_AI_MODEL: ""
    });
    assert.equal(input.name, "默认模型");
    assert.equal(input.baseUrl, "https://api.openai.com/v1");
    assert.equal(input.model, "gpt-4o-mini");
  });

  test("preserves empty API key without converting to default", () => {
    // Empty key is a valid state: user chose a provider in init.sh but
    // skipped the API key prompt. They'll fill it in via /admin/settings later.
    const input = buildModelConfigInput({ INIT_AI_PROVIDER: "openai" });
    assert.equal(input.apiKey, "");
  });
});

describe("shouldSeedAiModel", () => {
  const env = {
    INIT_AI_PROVIDER: "deepseek",
    INIT_AI_API_KEY: "sk-x"
  };

  test("returns null when env has no INIT_AI_PROVIDER", () => {
    assert.equal(shouldSeedAiModel({}, 0), null);
    assert.equal(shouldSeedAiModel({}, 5), null);
  });

  test("returns input when provider set and no existing models", () => {
    const result = shouldSeedAiModel(env, 0);
    assert.notEqual(result, null);
    assert.equal(result.provider, "deepseek");
  });

  test("returns null when provider set but at least one ModelConfig exists (idempotent)", () => {
    assert.equal(shouldSeedAiModel(env, 1), null);
    assert.equal(shouldSeedAiModel(env, 42), null);
  });

  test("idempotency guard fires regardless of which provider was previously seeded", () => {
    // The guard is a count check, so it doesn't matter what's already in the
    // table; even an unrelated row blocks seeding. This is the correct behavior
    // because we don't want init.sh to silently add a second default model
    // after the user already configured something via /admin/settings.
    assert.equal(shouldSeedAiModel({ INIT_AI_PROVIDER: "openai" }, 1), null);
  });
});

describe("buildAdminUpsertArgs", () => {
  const HASH = "bcrypt$fakehash$payload";

  test("uses env.ADMIN_USERNAME when set", () => {
    const args = buildAdminUpsertArgs({ ADMIN_USERNAME: "rooty" }, HASH);
    assert.equal(args.where.username, "rooty");
    assert.equal(args.create.username, "rooty");
  });

  test("falls back to 'admin' when ADMIN_USERNAME unset", () => {
    const args = buildAdminUpsertArgs({}, HASH);
    assert.equal(args.where.username, "admin");
  });

  test("trims whitespace from ADMIN_USERNAME", () => {
    const args = buildAdminUpsertArgs({ ADMIN_USERNAME: "  ops  " }, HASH);
    assert.equal(args.where.username, "ops");
  });

  test("create branch carries passwordHash", () => {
    const args = buildAdminUpsertArgs({}, HASH);
    assert.equal(args.create.passwordHash, HASH);
  });

  test("update branch carries passwordHash — this is the key fix for "
       + "the bug where re-running init.sh would silently keep the old DB password", () => {
    // BEFORE FIX: update was {} which made env.ADMIN_PASSWORD only effective
    // on the FIRST seed against an empty DB. After fix, every seed reconciles
    // the DB password to whatever .env says, so re-running the wizard to
    // change credentials actually takes effect on next container restart.
    const args = buildAdminUpsertArgs({}, HASH);
    assert.deepEqual(args.update, { passwordHash: HASH });
  });

  test("create and update share the same hash (no drift)", () => {
    const args = buildAdminUpsertArgs({ ADMIN_USERNAME: "x" }, HASH);
    assert.equal(args.create.passwordHash, args.update.passwordHash);
  });
});
