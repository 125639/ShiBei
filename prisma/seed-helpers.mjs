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

/** Resolve the authoritative admin username from deployment environment. */
export function adminUsernameFromEnv(env) {
  return env.ADMIN_USERNAME?.trim() || "admin";
}

/** First install: tokenVersion is intentionally omitted so the DB default (0) applies. */
export function buildAdminCreateData(env, passwordHash) {
  return {
    username: adminUsernameFromEnv(env),
    passwordHash
  };
}

/** Bootstrap the first administrator; never reconcile existing credentials with .env. */
export async function seedAdminIfNeeded(table, env, hashPassword) {
  const existing = await table.findFirst();
  if (existing) return existing;
  const password = env.ADMIN_PASSWORD;
  if (!password || password.trim().length < 8 || password === "change-me-now") {
    throw new Error("首次初始化必须设置非默认且至少 8 位的 ADMIN_PASSWORD；已有管理员请在后台修改密码。");
  }
  const passwordHash = await hashPassword(password);
  // A concurrent bootstrap of the same username must not overwrite its password.
  return table.upsert({
    where: { username: adminUsernameFromEnv(env) },
    update: {},
    create: buildAdminCreateData(env, passwordHash)
  });
}
