// Pure helpers extracted from prisma/seed.ts so they can be unit-tested
// without pulling in @prisma/client. Used by both seed.ts (production) and
// tests/test-seed.mjs (unit tests).

/**
 * @typedef {Object} ModelConfigInput
 * @property {string} provider
 * @property {string} name
 * @property {string} baseUrl
 * @property {string} model
 * @property {string} apiKey
 */

/**
 * Build the ModelConfig input from env vars. Returns null when no INIT_AI_PROVIDER
 * is set (i.e., user chose to skip AI in init.sh). All other fields fall back to
 * sane defaults so the row is always valid even with a half-filled .env.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {ModelConfigInput | null}
 */
export function buildModelConfigInput(env) {
  const provider = env.INIT_AI_PROVIDER?.trim();
  if (!provider) return null;
  return {
    provider,
    name: env.INIT_AI_NAME?.trim() || "默认模型",
    baseUrl: env.INIT_AI_BASE_URL?.trim() || "https://api.openai.com/v1",
    model: env.INIT_AI_MODEL?.trim() || "gpt-4o-mini",
    apiKey: env.INIT_AI_API_KEY ?? ""
  };
}

/**
 * Decide whether to seed the AI model. Returns the input to insert when seeding
 * should happen, otherwise null. The "already has any ModelConfig" check is the
 * idempotency guard: re-running db:seed must not duplicate the AI row.
 *
 * @param {Record<string, string | undefined>} env
 * @param {number} existingModelCount
 * @returns {ModelConfigInput | null}
 */
export function shouldSeedAiModel(env, existingModelCount) {
  const input = buildModelConfigInput(env);
  if (!input) return null;
  if (existingModelCount > 0) return null;
  return input;
}
