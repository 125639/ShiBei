import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "../src/lib/crypto";
import { seedDefaultTopics } from "../src/lib/topics";
import { seedDefaultModules } from "../src/lib/source-modules";
import { seedDefaultCreationGenres } from "../src/lib/creation";
import { BUNDLED_STYLE_PRESETS, DEFAULT_BLOG_STYLE, isLegacyBundledStyle } from "../src/lib/content-style";
import { normalizeModelBaseUrl } from "../src/lib/model-config-input";
import {
  seedAdminIfNeeded,
  shouldSeedAiModel
} from "./seed-helpers.mjs";

const prisma = new PrismaClient();

async function main() {
  await prisma.siteSettings.upsert({
    where: { id: "site" },
    update: {},
    create: {
      id: "site",
      name: "拾贝 信息博客",
      description: "抓取信息、AI 整理、人工审核发布的个人博客。",
      ownerName: "管理员",
      autoPublish: false
    }
  });

  // Bootstrap only: deployment variables must never undo a password changed in the UI.
  await seedAdminIfNeeded(prisma.adminUser, process.env, (password: string) => bcrypt.hash(password, 12));

  const bundledStyle = await prisma.contentStyle.findUnique({ where: { id: "default-style" } });
  if (!bundledStyle) {
    await prisma.contentStyle.create({
      data: { id: "default-style", ...DEFAULT_BLOG_STYLE, isDefault: true }
    });
  } else if (isLegacyBundledStyle(bundledStyle)) {
    // 只迁移安装包曾写入的完整旧签名。用户只要改过任一字段，就会保留其配置。
    await prisma.contentStyle.update({
      where: { id: bundledStyle.id },
      data: DEFAULT_BLOG_STYLE
    });
    console.log("[seed] 已将旧版新闻摘要风格升级为专业博客风格");
  }

  // 内置风格预设：按固定 id 补齐缺失项。已存在的行（含用户改过的）绝不覆盖。
  for (const { id, ...preset } of BUNDLED_STYLE_PRESETS) {
    const existing = await prisma.contentStyle.findUnique({ where: { id } });
    if (!existing) {
      await prisma.contentStyle.create({ data: { id, ...preset, isDefault: false } });
      console.log(`[seed] 已创建内置风格预设「${preset.name}」`);
    }
  }

  await seedDefaultTopics(prisma);
  await seedDefaultModules(prisma);
  await seedDefaultCreationGenres(prisma);

  // scripts/init.sh 写入的 INIT_AI_* 在首次 seed 时落盘为默认 ModelConfig。
  // shouldSeedAiModel 兼任输入校验 + 幂等守卫：已经有任何模型配置时不重复写。
  const existingCount = await prisma.modelConfig.count();
  const aiInput = shouldSeedAiModel(process.env as Record<string, string | undefined>, existingCount);
  if (aiInput) {
    await prisma.modelConfig.create({
      data: {
        provider: aiInput.provider,
        name: aiInput.name,
        baseUrl: normalizeModelBaseUrl(aiInput.baseUrl),
        model: aiInput.model,
        apiKeyEnc: encryptSecret(aiInput.apiKey),
        maxTokens: 8000,
        isDefault: true
      }
    });
    console.log(`[seed] 已写入默认 AI 模型: ${aiInput.provider}`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
