import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "../src/lib/crypto";
import { seedDefaultTopics } from "../src/lib/topics";
import { seedDefaultModules } from "../src/lib/source-modules";
import { buildAdminUpsertArgs, shouldSeedAiModel } from "./seed-helpers.mjs";

const prisma = new PrismaClient();

async function main() {
  const username = process.env.ADMIN_USERNAME || "admin";
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

  // 关键：buildAdminUpsertArgs 把 passwordHash 写进 update 分支，所以每次
  // db:seed（即每次容器启动）都会用 .env 的 ADMIN_PASSWORD 覆盖数据库里的
  // admin 密码。这意味着 .env 是密码的权威来源——重跑向导改密码立刻生效。
  // 配套语义：UI 上改密码不持久，重启会被 .env 覆盖；如需 UI 持久化，需要
  // 同步把新密码写回 .env。
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.adminUser.upsert(
    buildAdminUpsertArgs(process.env as Record<string, string | undefined>, passwordHash)
  );

  await prisma.summaryStyle.upsert({
    where: { id: "default-style" },
    update: {},
    create: {
      id: "default-style",
      name: "默认博客文章",
      tone: "客观新闻",
      length: "中",
      focus: "核心事实, 行业影响, 背景脉络, 多方观点",
      outputStructure: "标题 → 导语 → 正文分章节叙述 → 背景分析 → 参考来源",
      promptTemplate: "写一篇有深度的中文博客文章，要求正式标题、导语段落、分章节连贯叙述，禁止写成摘要或要点列表。",
      isDefault: true
    }
  });

  await seedDefaultTopics(prisma);
  await seedDefaultModules(prisma);

  // scripts/init.sh 写入的 INIT_AI_* 在首次 seed 时落盘为默认 ModelConfig。
  // shouldSeedAiModel 兼任输入校验 + 幂等守卫：已经有任何模型配置时不重复写。
  const existingCount = await prisma.modelConfig.count();
  const aiInput = shouldSeedAiModel(process.env as Record<string, string | undefined>, existingCount);
  if (aiInput) {
    await prisma.modelConfig.create({
      data: {
        provider: aiInput.provider,
        name: aiInput.name,
        baseUrl: aiInput.baseUrl,
        model: aiInput.model,
        apiKeyEnc: encryptSecret(aiInput.apiKey),
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
