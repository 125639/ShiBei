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

export function adminUsernameFromEnv(
  env: Record<string, string | undefined>
): string;

export function buildAdminCreateData(
  env: Record<string, string | undefined>,
  passwordHash: string
): {
  username: string;
  passwordHash: string;
};

export function seedAdminIfNeeded(
  table: Pick<import("@prisma/client").PrismaClient["adminUser"], "findFirst" | "upsert">,
  env: Record<string, string | undefined>,
  hashPassword: (password: string) => Promise<string>
): Promise<import("@prisma/client").AdminUser>;
