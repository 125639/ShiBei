import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "../src/lib/crypto";
import { seedDefaultTopics } from "../src/lib/topics";
import { seedDefaultModules } from "../src/lib/source-modules";
import { seedDefaultCreationGenres } from "../src/lib/creation";
import { DEFAULT_BLOG_STYLE, isLegacyBundledStyle } from "../src/lib/content-style";
import { normalizeModelBaseUrl } from "../src/lib/model-config-input";
import {
  adminUsernameFromEnv,
  buildAdminCreateData,
  buildAdminPasswordRotationData,
  shouldSeedAiModel
} from "./seed-helpers.mjs";

const prisma = new PrismaClient();

async function main() {
  const password = process.env.ADMIN_PASSWORD || "change-me-now";

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

  // .env 仍是管理员密码的权威来源，但普通重启不能因为 bcrypt 每次产生新盐就
  // 重写 hash 或强制退出。先 compare 现有 hash；只有密码实际变化时才更新，
  // 并递增 tokenVersion 吊销旧 JWT。首次安装正常创建，版本沿用 DB 默认值 0。
  const env = process.env as Record<string, string | undefined>;
  const adminUsername = adminUsernameFromEnv(env);
  const existingAdmin = await prisma.adminUser.findUnique({ where: { username: adminUsername } });
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.adminUser.create({ data: buildAdminCreateData(env, passwordHash) });
  } else if (!(await bcrypt.compare(password, existingAdmin.passwordHash))) {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.adminUser.update({
      where: { id: existingAdmin.id },
      data: buildAdminPasswordRotationData(passwordHash)
    });
    console.log("[seed] ADMIN_PASSWORD 已变化：管理员密码已同步，旧会话已吊销");
  }

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
