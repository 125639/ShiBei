export type ModelConfigInput = {
  provider: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

export function buildModelConfigInput(env: Record<string, string | undefined>): ModelConfigInput | null;

export function shouldSeedAiModel(
  env: Record<string, string | undefined>,
  existingModelCount: number
): ModelConfigInput | null;

export function buildAdminUpsertArgs(
  env: Record<string, string | undefined>,
  passwordHash: string
): {
  where: { username: string };
  update: { passwordHash: string };
  create: { username: string; passwordHash: string };
};
